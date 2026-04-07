// Package daemon implements the core rioku daemon lifecycle.
// It owns the gRPC server, REST gateway, config engine, sync loop,
// plugin host, build manager, and Caddy child process.
package daemon

import (
	"context"
	"fmt"
	"log"
	"path/filepath"
	"time"

	"github.com/riokulabs/rioku/internal/caddy"
	"github.com/riokulabs/rioku/internal/config"
	riokugrpc "github.com/riokulabs/rioku/internal/grpc"
	"github.com/riokulabs/rioku/internal/store"
	raftstore "github.com/riokulabs/rioku/internal/store/raft"
	riokusync "github.com/riokulabs/rioku/internal/sync"

	// Register store drivers.
	_ "github.com/riokulabs/rioku/internal/store/sqlite"
)

// Daemon orchestrates all subsystems.
type Daemon struct {
	cfg       *config.Config
	cfgPath   string
	store     store.Driver
	caddy     *caddy.Manager
	engine    *config.Engine
	grpc      *riokugrpc.Server
	syncAgent *riokusync.Agent
	pidFile   string
	startedAt time.Time
}

// DaemonHealth reports the health of the daemon and its subsystems.
type DaemonHealth struct {
	Running bool               `json:"running"`
	PID     int                `json:"pid"`
	Uptime  time.Duration      `json:"uptime"`
	Store   store.DriverHealth `json:"store"`
	CaddyUp bool               `json:"caddy_up"`
}

// New creates a new Daemon from the given config.
func New(cfg *config.Config, cfgPath string) *Daemon {
	pidFile := filepath.Join(cfg.DataDir, "rioku.pid")
	return &Daemon{
		cfg:     cfg,
		cfgPath: cfgPath,
		pidFile: pidFile,
	}
}

// Start initializes all subsystems and blocks until the context is cancelled.
func (d *Daemon) Start(ctx context.Context) error {
	d.startedAt = time.Now()

	// 1. Open store.
	drv, err := d.openStore(ctx)
	if err != nil {
		return fmt.Errorf("open store: %w", err)
	}
	d.store = drv

	// 2. Run migrations.
	if err := d.store.Migrate(ctx, store.MigrateUp); err != nil {
		d.store.Close()
		return fmt.Errorf("migrate: %w", err)
	}
	log.Printf("store: %s driver ready", d.cfg.Store.Driver)

	// 3. Create config engine.
	compiler := caddy.NewCompiler()
	d.engine = config.NewEngine(d.store, compiler)
	log.Println("config: engine ready")

	// 4. Start Caddy child process (optional — warns if binary missing).
	d.caddy = caddy.NewManager(caddy.ManagerConfig{
		Binary:    d.cfg.Caddy.Binary,
		AdminAddr: d.cfg.Caddy.AdminAddr,
		DataDir:   d.cfg.Caddy.DataDir,
	})
	if err := d.caddy.Start(ctx); err != nil {
		log.Printf("caddy: %v (traffic proxying unavailable)", err)
	} else {
		log.Printf("caddy: child process started (admin: %s)", d.cfg.Caddy.AdminAddr)
	}

	// 5. Start sync agent (watches config changes, pushes to Caddy).
	d.syncAgent = riokusync.NewAgent(d.engine, d.caddy)
	d.syncAgent.Start(ctx)

	// 6. Start gRPC server.
	grpcAddr := d.cfg.Listen.GRPC
	if grpcAddr == "" {
		grpcAddr = ":7777"
	}
	grpcSrv, err := riokugrpc.NewServer(grpcAddr, d.engine, d.store, d.caddy)
	if err != nil {
		log.Printf("grpc: failed to start: %v", err)
	} else {
		d.grpc = grpcSrv
		go func() {
			if err := d.grpc.Start(); err != nil {
				log.Printf("grpc: server error: %v", err)
			}
		}()
	}

	// 7. Write PID file.
	if err := WritePIDFile(d.pidFile); err != nil {
		log.Printf("warning: failed to write pid file: %v", err)
	}

	log.Printf("daemon: ready (pid file: %s)", d.pidFile)

	// 8. Block until context is cancelled (signal handler).
	<-ctx.Done()

	// 9. Graceful shutdown.
	return d.Stop(context.Background())
}

// Stop shuts down all subsystems in reverse order.
func (d *Daemon) Stop(ctx context.Context) error {
	log.Println("daemon: shutting down...")

	// Stop gRPC server.
	if d.grpc != nil {
		d.grpc.Stop()
	}

	// Stop sync agent.
	if d.syncAgent != nil {
		d.syncAgent.Stop()
	}

	// Stop Caddy.
	if d.caddy != nil {
		if err := d.caddy.Stop(ctx); err != nil {
			log.Printf("caddy: stop error: %v", err)
		}
	}

	// Close store.
	if d.store != nil {
		if err := d.store.Close(); err != nil {
			log.Printf("store: close error: %v", err)
		}
	}

	// Remove PID file.
	RemovePIDFile(d.pidFile)

	log.Println("daemon: stopped")
	return nil
}

// Health returns the current health of the daemon and its subsystems.
func (d *Daemon) Health(ctx context.Context) DaemonHealth {
	h := DaemonHealth{
		Running: true,
		Uptime:  time.Since(d.startedAt),
	}
	if d.store != nil {
		h.Store = d.store.Health(ctx)
	}
	if d.caddy != nil {
		h.CaddyUp = d.caddy.IsRunning()
	}
	return h
}

// PIDFile returns the path to the PID file.
func (d *Daemon) PIDFile() string {
	return d.pidFile
}

func (d *Daemon) openStore(ctx context.Context) (store.Driver, error) {
	driverName := d.cfg.Store.Driver
	if driverName == "" {
		driverName = "raft"
	}

	drv, err := store.New(driverName)
	if err != nil {
		return nil, err
	}

	// Configure raft-specific settings if using the raft driver.
	if driverName == "raft" {
		if rd, ok := drv.(*raftstore.Driver); ok {
			nodeID := d.cfg.Store.Raft.NodeID
			if nodeID == "" {
				nodeID = "node-0"
			}
			bindAddr := d.cfg.Store.Raft.BindAddr
			if bindAddr == "" {
				bindAddr = "127.0.0.1:7779"
			}
			dataDir := d.cfg.Store.Raft.DataDir
			if dataDir == "" {
				dataDir = filepath.Join(d.cfg.DataDir, "raft")
			}
			rd.SetRaftConfig(raftstore.RaftConfig{
				NodeID:        nodeID,
				DataDir:       dataDir,
				BindAddr:      bindAddr,
				AdvertiseAddr: bindAddr,
				Bootstrap:     d.cfg.Store.Raft.Bootstrap,
			})
		}
	}

	driverCfg := store.DriverConfig{
		Driver: driverName,
		Path:   d.cfg.Store.SQLite.Path,
		DSN:    d.cfg.Store.Postgres.DSN,
	}
	if err := drv.Open(ctx, driverCfg); err != nil {
		return nil, err
	}

	return drv, nil
}
