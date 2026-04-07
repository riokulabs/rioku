package wasm

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"

	"github.com/tetratelabs/wazero"
	"github.com/tetratelabs/wazero/api"
)

// Host manages the wazero runtime and loaded plugin modules.
type Host struct {
	mu      sync.RWMutex
	runtime wazero.Runtime
	plugins map[string]*Plugin
	closed  bool
}

// Plugin represents a loaded WASM plugin module.
type Plugin struct {
	mu       sync.RWMutex
	name     string
	compiled wazero.CompiledModule
	host     *Host
	pool     *InstancePool
	config   []byte // Plugin-specific JSON config
	version  atomic.Int64
}

// NewHost creates a new WASM host with the given runtime configuration.
func NewHost(ctx context.Context, memoryLimitPages uint32) (*Host, error) {
	cfg := wazero.NewRuntimeConfig()
	if memoryLimitPages > 0 {
		cfg = cfg.WithMemoryLimitPages(memoryLimitPages)
	}

	rt := wazero.NewRuntimeWithConfig(ctx, cfg)

	h := &Host{
		runtime: rt,
		plugins: make(map[string]*Plugin),
	}

	// Register the Rioku host module with all ABI functions.
	if err := h.registerHostModule(ctx); err != nil {
		rt.Close(ctx)
		return nil, err
	}

	return h, nil
}

// registerHostModule registers all Rioku ABI host functions.
func (h *Host) registerHostModule(ctx context.Context) error {
	i32 := api.ValueTypeI32

	_, err := h.runtime.NewHostModuleBuilder("rioku").
		NewFunctionBuilder().
		WithGoModuleFunction(api.GoModuleFunc(hostGetRequestHeader),
			[]api.ValueType{i32, i32}, []api.ValueType{i32, i32}).
		WithParameterNames("name_ptr", "name_len").
		WithResultNames("val_ptr", "val_len").
		Export("get_request_header").
		NewFunctionBuilder().
		WithGoModuleFunction(api.GoModuleFunc(hostSetRequestHeader),
			[]api.ValueType{i32, i32, i32, i32}, nil).
		WithParameterNames("name_ptr", "name_len", "val_ptr", "val_len").
		Export("set_request_header").
		NewFunctionBuilder().
		WithGoModuleFunction(api.GoModuleFunc(hostGetRequestPath),
			nil, []api.ValueType{i32, i32}).
		WithResultNames("ptr", "len").
		Export("get_request_path").
		NewFunctionBuilder().
		WithGoModuleFunction(api.GoModuleFunc(hostGetRequestMethod),
			nil, []api.ValueType{i32, i32}).
		WithResultNames("ptr", "len").
		Export("get_request_method").
		NewFunctionBuilder().
		WithGoModuleFunction(api.GoModuleFunc(hostSetResponseStatus),
			[]api.ValueType{i32}, nil).
		WithParameterNames("code").
		Export("set_response_status").
		NewFunctionBuilder().
		WithGoModuleFunction(api.GoModuleFunc(hostSetResponseHeader),
			[]api.ValueType{i32, i32, i32, i32}, nil).
		WithParameterNames("name_ptr", "name_len", "val_ptr", "val_len").
		Export("set_response_header").
		NewFunctionBuilder().
		WithGoModuleFunction(api.GoModuleFunc(hostSetResponseBody),
			[]api.ValueType{i32, i32}, nil).
		WithParameterNames("body_ptr", "body_len").
		Export("set_response_body").
		NewFunctionBuilder().
		WithGoModuleFunction(api.GoModuleFunc(hostLogInfo),
			[]api.ValueType{i32, i32}, nil).
		WithParameterNames("msg_ptr", "msg_len").
		Export("log_info").
		NewFunctionBuilder().
		WithGoModuleFunction(api.GoModuleFunc(hostGetPluginConfig),
			nil, []api.ValueType{i32, i32}).
		WithResultNames("ptr", "len").
		Export("get_plugin_config").
		Instantiate(ctx)

	return err
}

// LoadPlugin compiles a WASM module and creates an instance pool.
func (h *Host) LoadPlugin(ctx context.Context, name string, wasmBytes []byte, config []byte, poolSize int) (*Plugin, error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.closed {
		return nil, fmt.Errorf("wasm: host is closed")
	}

	compiled, err := h.runtime.CompileModule(ctx, wasmBytes)
	if err != nil {
		return nil, fmt.Errorf("wasm: compile %s: %w", name, err)
	}

	p := &Plugin{
		name:     name,
		compiled: compiled,
		host:     h,
		config:   config,
	}

	pool, err := newInstancePool(ctx, h.runtime, compiled, name, poolSize)
	if err != nil {
		compiled.Close(ctx)
		return nil, fmt.Errorf("wasm: create pool for %s: %w", name, err)
	}
	p.pool = pool

	// Close any existing plugin with the same name (hot-swap).
	if old, exists := h.plugins[name]; exists {
		old.close(ctx)
	}

	h.plugins[name] = p
	return p, nil
}

// GetPlugin returns a loaded plugin by name.
func (h *Host) GetPlugin(name string) (*Plugin, bool) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	p, ok := h.plugins[name]
	return p, ok
}

// UnloadPlugin removes and closes a plugin.
func (h *Host) UnloadPlugin(ctx context.Context, name string) error {
	h.mu.Lock()
	defer h.mu.Unlock()

	p, ok := h.plugins[name]
	if !ok {
		return fmt.Errorf("wasm: plugin %s not found", name)
	}
	delete(h.plugins, name)
	return p.close(ctx)
}

// Close shuts down the host and all loaded plugins.
func (h *Host) Close(ctx context.Context) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.closed = true

	for name, p := range h.plugins {
		p.close(ctx)
		delete(h.plugins, name)
	}
	return h.runtime.Close(ctx)
}

// HandleRequest invokes a plugin's handle_request function with the given RequestContext.
func (p *Plugin) HandleRequest(ctx context.Context, rc *RequestContext) (Action, error) {
	rc.PluginConfig = p.config

	inst, err := p.pool.Acquire(ctx)
	if err != nil {
		return ActionContinue, fmt.Errorf("wasm: acquire instance: %w", err)
	}
	defer p.pool.Release(inst)

	// Attach the request context so host functions can access it.
	ctx = withRequestContext(ctx, rc)

	// Call handle_request.
	handleReq := inst.mod.ExportedFunction("handle_request")
	if handleReq == nil {
		return ActionContinue, fmt.Errorf("wasm: plugin %s does not export handle_request", p.name)
	}

	results, err := handleReq.Call(ctx)
	if err != nil {
		return ActionContinue, fmt.Errorf("wasm: handle_request: %w", err)
	}

	action := ActionContinue
	if len(results) > 0 {
		action = Action(results[0])
	}
	return action, nil
}

// HotSwap replaces the plugin's compiled module and drains the old pool.
func (p *Plugin) HotSwap(ctx context.Context, newWasmBytes []byte) error {
	compiled, err := p.host.runtime.CompileModule(ctx, newWasmBytes)
	if err != nil {
		return fmt.Errorf("wasm: compile for hot-swap: %w", err)
	}

	newPool, err := newInstancePool(ctx, p.host.runtime, compiled, p.name, p.pool.size)
	if err != nil {
		compiled.Close(ctx)
		return fmt.Errorf("wasm: create pool for hot-swap: %w", err)
	}

	p.mu.Lock()
	oldPool := p.pool
	oldCompiled := p.compiled
	p.pool = newPool
	p.compiled = compiled
	p.version.Add(1)
	p.mu.Unlock()

	// Drain old pool — wait for in-flight requests to finish, then close.
	oldPool.Drain(ctx)
	oldCompiled.Close(ctx)

	return nil
}

func (p *Plugin) close(ctx context.Context) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.pool != nil {
		p.pool.Drain(ctx)
	}
	if p.compiled != nil {
		return p.compiled.Close(ctx)
	}
	return nil
}
