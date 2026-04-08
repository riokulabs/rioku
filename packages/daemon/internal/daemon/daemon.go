// Package daemon implements the core rioku daemon lifecycle.
// It owns the gRPC server, REST gateway, config engine, sync loop,
// plugin host, build manager, and Caddy child process.
package daemon

import (
	"context"
	"crypto/rand"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/caddy"
	"github.com/riokulabs/rioku/internal/config"
	"github.com/riokulabs/rioku/internal/gateway"
	riokugrpc "github.com/riokulabs/rioku/internal/grpc"
	"github.com/riokulabs/rioku/internal/store"
	raftstore "github.com/riokulabs/rioku/internal/store/raft"
	riokusync "github.com/riokulabs/rioku/internal/sync"
	riokuweb "github.com/riokulabs/rioku/web"

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
	auth      *auth.Auth
	sessions  *auth.SessionManager
	grpc      *riokugrpc.Server
	gateway   *gateway.Gateway
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

	// 3. Create auth.
	signingKeyPath := filepath.Join(d.cfg.DataDir, "signing.key")
	signingKey, err := loadOrCreateSigningKey(signingKeyPath)
	if err != nil {
		d.store.Close()
		return fmt.Errorf("auth signing key: %w", err)
	}
	d.auth = auth.NewAuth(signingKey, d.store)
	log.Println("auth: ready")

	// 3a. Create session manager.
	d.sessions = auth.NewSessionManager(d.store, d.cfg.Auth.DevMode)
	d.sessions.StartCleanupWorker(ctx)
	log.Println("sessions: manager ready")

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

	// 5. Start gRPC server.
	grpcAddr := d.cfg.Listen.GRPC
	if grpcAddr == "" {
		grpcAddr = ":7777"
	}
	grpcSrv, err := riokugrpc.NewServer(grpcAddr, d.engine, d.store, d.caddy, d.auth)
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

	// 6. Start REST gateway on loopback (OS-assigned port).
	if d.grpc != nil {
		spaFS, err := riokuweb.SPA()
		if err != nil {
			log.Printf("web: admin panel not available: %v", err)
		}

		gw, err := gateway.NewGateway("127.0.0.1:0", d.grpc.ConfigService(), d.grpc.HealthService(), d.auth, d.sessions, d.engine, d.store, d.cfg, spaFS)
		if err != nil {
			log.Printf("rest: failed to start: %v", err)
		} else {
			d.gateway = gw
			log.Printf("rest: internal gateway bound to %s", d.gateway.Addr())
			go func() {
				if err := d.gateway.Start(); err != nil {
					log.Printf("rest: server error: %v", err)
				}
			}()
		}
	}

	// 7. Create config engine with Caddy compiler (needs gateway internal address).
	adminListenAddr := d.cfg.Listen.REST
	if adminListenAddr == "" {
		adminListenAddr = ":7778"
	}
	var internalAddr string
	if d.gateway != nil {
		internalAddr = d.gateway.Addr()
	}
	trafficAddrs := d.cfg.Caddy.TrafficAddrs
	if len(trafficAddrs) == 0 {
		trafficAddrs = []string{":443"}
	}
	compiler := caddy.NewCompiler(trafficAddrs, caddy.AdminConfig{
		InternalAddr: internalAddr,
		ListenAddr:   adminListenAddr,
		Domain:       d.cfg.Listen.AdminDomain,
		DevMode:      d.cfg.Auth.DevMode,
	})
	d.engine = config.NewEngine(d.store, compiler)
	log.Println("config: engine ready")

	// 8. Start sync agent (watches config changes, pushes to Caddy).
	d.syncAgent = riokusync.NewAgent(d.engine, d.caddy)
	d.syncAgent.Start(ctx)

	// 9. Write PID file.
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

	// Stop REST gateway.
	if d.gateway != nil {
		if err := d.gateway.Stop(ctx); err != nil {
			log.Printf("rest: stop error: %v", err)
		}
	}

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

// loadOrCreateSigningKey loads the JWT signing key from disk, or generates
// a new one if it doesn't exist.
func loadOrCreateSigningKey(path string) ([]byte, error) {
	data, err := os.ReadFile(path)
	if err == nil && len(data) >= 32 {
		return data, nil
	}

	// Generate a new 32-byte key.
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, fmt.Errorf("generate signing key: %w", err)
	}

	if err := os.MkdirAll(filepath.Dir(path), 0750); err != nil {
		return nil, fmt.Errorf("create key dir: %w", err)
	}
	if err := os.WriteFile(path, key, 0600); err != nil {
		return nil, fmt.Errorf("write signing key: %w", err)
	}

	return key, nil
}
