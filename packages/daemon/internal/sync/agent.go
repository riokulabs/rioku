// Package sync implements the cluster sync agent. Each node watches
// the config store for changes and pushes them to its local Caddy
// instance via the admin API.
package sync

import (
	"context"
	"log"
	"time"

	"github.com/riokulabs/rioku/internal/caddy"
	"github.com/riokulabs/rioku/internal/config"
)

// Agent watches config changes and pushes compiled Caddy JSON to the
// Caddy admin API. Single-node version (no cluster coordination).
type Agent struct {
	engine   *config.Engine
	caddyMgr *caddy.Manager
	stopCh   chan struct{}
	done     chan struct{}
}

// NewAgent creates a new sync agent.
func NewAgent(engine *config.Engine, caddyMgr *caddy.Manager) *Agent {
	return &Agent{
		engine:   engine,
		caddyMgr: caddyMgr,
		stopCh:   make(chan struct{}),
		done:     make(chan struct{}),
	}
}

// Start begins the sync loop. Performs an initial sync, then watches for changes.
func (a *Agent) Start(ctx context.Context) {
	// Initial sync — push current config to Caddy.
	if err := a.syncOnce(ctx); err != nil {
		log.Printf("sync: initial sync failed: %v", err)
	} else {
		log.Println("sync: initial config pushed to Caddy")
	}

	go a.run(ctx)
}

// Stop signals the sync loop to stop and waits for it to finish.
func (a *Agent) Stop() {
	close(a.stopCh)
	<-a.done
}

func (a *Agent) run(ctx context.Context) {
	defer close(a.done)

	ch, err := a.engine.WatchChanges(ctx, 0)
	if err != nil {
		log.Printf("sync: watch changes failed: %v", err)
		return
	}

	// Debounce: if multiple changes arrive within 100ms, compile once.
	var debounce *time.Timer
	pending := false

	for {
		select {
		case <-a.stopCh:
			if debounce != nil {
				debounce.Stop()
			}
			return
		case <-ctx.Done():
			if debounce != nil {
				debounce.Stop()
			}
			return
		case _, ok := <-ch:
			if !ok {
				return
			}
			if debounce == nil {
				debounce = time.NewTimer(100 * time.Millisecond)
			} else {
				if !debounce.Stop() {
					select {
					case <-debounce.C:
					default:
					}
				}
				debounce.Reset(100 * time.Millisecond)
			}
			pending = true
		case <-debounceC(debounce):
			if pending {
				if err := a.syncOnce(ctx); err != nil {
					log.Printf("sync: push to Caddy failed: %v", err)
				} else {
					log.Println("sync: config pushed to Caddy")
				}
				pending = false
			}
		}
	}
}

func (a *Agent) syncOnce(ctx context.Context) error {
	if a.caddyMgr == nil || !a.caddyMgr.IsRunning() {
		return nil
	}

	data, err := a.engine.CompileCaddyConfig(ctx)
	if err != nil {
		return err
	}

	return a.caddyMgr.PushConfig(ctx, data)
}

// debounceC safely returns the timer channel or nil.
func debounceC(t *time.Timer) <-chan time.Time {
	if t == nil {
		return nil
	}
	return t.C
}
