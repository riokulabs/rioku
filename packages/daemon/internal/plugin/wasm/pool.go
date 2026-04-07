package wasm

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"

	"github.com/tetratelabs/wazero"
	"github.com/tetratelabs/wazero/api"
)

// instance wraps a wazero module instance.
type instance struct {
	mod api.Module
}

// globalInstanceCounter ensures unique module names across all pools.
var globalInstanceCounter atomic.Int64

// InstancePool manages a pool of pre-warmed WASM module instances.
// CompiledModule is thread-safe (shared). Module instances are NOT —
// each concurrent request gets its own instance from the pool.
type InstancePool struct {
	mu       sync.Mutex
	runtime  wazero.Runtime
	compiled wazero.CompiledModule
	name     string
	size     int

	free    []*instance
	inUse   int
	closed  bool
	drainCh chan struct{} // closed when drain completes
}

// newInstancePool creates a pool and pre-warms it with `size` instances.
func newInstancePool(ctx context.Context, rt wazero.Runtime, compiled wazero.CompiledModule, name string, size int) (*InstancePool, error) {
	if size <= 0 {
		size = 4
	}

	p := &InstancePool{
		runtime:  rt,
		compiled: compiled,
		name:     name,
		size:     size,
		free:     make([]*instance, 0, size),
		drainCh:  make(chan struct{}),
	}

	// Pre-warm.
	for i := 0; i < size; i++ {
		inst, err := p.createInstance(ctx)
		if err != nil {
			// Close any already-created instances.
			for _, existing := range p.free {
				existing.mod.Close(ctx)
			}
			return nil, fmt.Errorf("pre-warm instance %d: %w", i, err)
		}
		p.free = append(p.free, inst)
	}

	return p, nil
}

// createInstance creates a new WASM module instance from the compiled module.
func (p *InstancePool) createInstance(ctx context.Context) (*instance, error) {
	n := globalInstanceCounter.Add(1)
	modName := fmt.Sprintf("%s_%d", p.name, n)

	cfg := wazero.NewModuleConfig().
		WithName(modName).
		WithStartFunctions() // Don't auto-call _start

	mod, err := p.runtime.InstantiateModule(ctx, p.compiled, cfg)
	if err != nil {
		return nil, fmt.Errorf("instantiate %s: %w", modName, err)
	}
	return &instance{mod: mod}, nil
}

// Acquire takes an instance from the pool. If the pool is empty, creates a new one.
func (p *InstancePool) Acquire(ctx context.Context) (*instance, error) {
	p.mu.Lock()

	if p.closed {
		p.mu.Unlock()
		return nil, fmt.Errorf("pool is closed")
	}

	if len(p.free) > 0 {
		inst := p.free[len(p.free)-1]
		p.free = p.free[:len(p.free)-1]
		p.inUse++
		p.mu.Unlock()
		return inst, nil
	}

	p.inUse++
	p.mu.Unlock()

	// Pool exhausted — create a new instance on demand.
	return p.createInstance(ctx)
}

// Release returns an instance to the pool.
func (p *InstancePool) Release(inst *instance) {
	p.mu.Lock()
	defer p.mu.Unlock()

	p.inUse--

	if p.closed {
		// Pool is draining — close the instance and signal if all done.
		inst.mod.Close(context.Background())
		if p.inUse == 0 {
			select {
			case <-p.drainCh:
			default:
				close(p.drainCh)
			}
		}
		return
	}

	// Return to pool if under capacity.
	if len(p.free) < p.size {
		p.free = append(p.free, inst)
	} else {
		inst.mod.Close(context.Background())
	}
}

// Drain closes the pool and waits for all in-use instances to be returned.
func (p *InstancePool) Drain(ctx context.Context) {
	p.mu.Lock()

	if p.closed {
		p.mu.Unlock()
		return
	}
	p.closed = true

	// Close all free instances.
	for _, inst := range p.free {
		inst.mod.Close(ctx)
	}
	p.free = nil

	if p.inUse == 0 {
		close(p.drainCh)
		p.mu.Unlock()
		return
	}
	p.mu.Unlock()

	// Wait for in-flight instances to be returned.
	select {
	case <-p.drainCh:
	case <-ctx.Done():
	}
}

// Stats returns pool statistics.
func (p *InstancePool) Stats() PoolStats {
	p.mu.Lock()
	defer p.mu.Unlock()
	return PoolStats{
		Free:     len(p.free),
		InUse:    p.inUse,
		Created:  globalInstanceCounter.Load(),
		Capacity: p.size,
	}
}

// PoolStats contains instance pool statistics.
type PoolStats struct {
	Free     int
	InUse    int
	Created  int64
	Capacity int
}
