// Package daemon implements the core rioku daemon lifecycle.
// It owns the gRPC server, REST gateway, config engine, sync loop,
// plugin host, build manager, and Caddy child process.
package daemon

import (
	"context"
	"crypto/rand"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/caddy"
	"github.com/riokulabs/rioku/internal/config"
	"github.com/riokulabs/rioku/internal/gateway"
	riokugrpc "github.com/riokulabs/rioku/internal/grpc"
	"github.com/riokulabs/rioku/internal/logging"
	"github.com/riokulabs/rioku/internal/store"
	raftstore "github.com/riokulabs/rioku/internal/store/raft"
	riokusync "github.com/riokulabs/rioku/internal/sync"
	"github.com/riokulabs/rioku/internal/tlsask"
	"github.com/riokulabs/rioku/internal/tracestore"
	"github.com/riokulabs/rioku/internal/vault"
	riokuweb "github.com/riokulabs/rioku/web"

	// Register store drivers.
	_ "github.com/riokulabs/rioku/internal/store/sqlite"

	// Register tracestore drivers.
	_ "github.com/riokulabs/rioku/internal/tracestore/sqlite"
)

// Daemon orchestrates all subsystems.
type Daemon struct {
	cfg             *config.Config
	cfgPath         string
	store           store.Driver
	caddy           *caddy.Manager
	engine          *config.Engine
	auth            *auth.Auth
	sessions        *auth.SessionManager
	grpc            *riokugrpc.Server
	gateway         *gateway.Gateway
	syncAgent       *riokusync.Agent
	tlsAsk          *tlsask.Server
	upstreamHealth  *caddy.UpstreamHealthPoller
	traceStore      tracestore.Driver
	ringBuffer      *tracestore.RingBuffer
	ingester        *tracestore.Ingester
	aggregator      *tracestore.Aggregator
	logLevel        *slog.LevelVar
	loggingShutdown logging.Shutdown
	pidFile         string
	startedAt       time.Time
	vaultResolver   *vault.CachingResolver
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

	// 0. Initialize the vault reference resolver before logging so
	// OTLP Headers can resolve {vault://...} refs at handler build
	// time. The default registers env, file, and op (1Password CLI)
	// backends with a 5-minute cache and 15-minute rotation.
	d.vaultResolver = vault.DefaultCaching(vault.DefaultOptions{
		CacheTTL:         5 * time.Minute,
		RotationInterval: 15 * time.Minute,
	})
	go d.vaultResolver.RotationLoop(ctx, 15*time.Minute)

	// 0a. Initialize structured logging.
	lv, loggingShutdown, err := logging.Setup(d.cfg.Logging, d.vaultResolver)
	if err != nil {
		return fmt.Errorf("logging setup: %w", err)
	}
	d.logLevel = lv
	d.loggingShutdown = loggingShutdown

	// Create component loggers.
	storeLog := slog.Default().With("component", "store")
	caddyLog := slog.Default().With("component", "caddy")
	grpcLog := slog.Default().With("component", "grpc")
	gwLog := slog.Default().With("component", "gateway")
	syncLog := slog.Default().With("component", "sync")
	traceLog := slog.Default().With("component", "tracestore")

	// 1. Open store.
	drv, err := d.openStore(ctx)
	if err != nil {
		return fmt.Errorf("open store: %w", err)
	}
	d.store = drv

	// 2. Run migrations.
	if err := d.store.Migrate(ctx, store.MigrateUp); err != nil {
		_ = d.store.Close()
		return fmt.Errorf("migrate: %w", err)
	}
	storeLog.Info("driver ready", "driver", d.cfg.Store.Driver)

	// 3. Create auth.
	signingKeyPath := filepath.Join(d.cfg.DataDir, "signing.key")
	signingKey, err := loadOrCreateSigningKey(signingKeyPath)
	if err != nil {
		_ = d.store.Close()
		return fmt.Errorf("auth signing key: %w", err)
	}
	d.auth = auth.NewAuth(signingKey, d.store)
	slog.Info("auth ready", "component", "auth")

	// 3a. Create session manager.
	d.sessions = auth.NewSessionManager(d.store, d.cfg.Auth.DevMode)
	d.sessions.StartCleanupWorker(ctx)
	slog.Info("session manager ready", "component", "sessions")

	// 3b. Open trace store.
	traceDrv, err := tracestore.New(d.cfg.Traces.Store)
	if err != nil {
		traceLog.Warn("driver not available", "driver", d.cfg.Traces.Store, "error", err)
	} else {
		// Ensure trace store directory exists.
		if err := os.MkdirAll(d.cfg.Traces.Path, 0750); err != nil {
			traceLog.Error("cannot create dir", "path", d.cfg.Traces.Path, "error", err)
		}
		traceCfg := tracestore.DriverConfig{
			Driver:    d.cfg.Traces.Store,
			Path:      filepath.Join(d.cfg.Traces.Path, "traces.db"),
			MaxSizeGB: d.cfg.Traces.MaxSizeGB,
		}
		if err := traceDrv.Open(ctx, traceCfg); err != nil {
			traceLog.Warn("open failed, traces unavailable", "error", err)
		} else {
			d.traceStore = traceDrv
			traceLog.Info("ready")
		}
	}

	// 3c. Create ring buffer.
	d.ringBuffer = tracestore.NewRingBuffer(d.cfg.Traces.BufferSize)

	// 4. Create config engine with placeholder compiler (updated after gateway binds).
	placeholderCompiler := caddy.NewCompiler([]string{":443"}, caddy.AdminConfig{}, "", nil, caddy.SecurityHeadersConfig{})
	d.engine = config.NewEngine(d.store, placeholderCompiler)
	slog.Info("config engine ready (compiler will be updated after gateway binds)", "component", "config")

	// 5. Start Caddy child process (optional — warns if binary missing).
	d.caddy = caddy.NewManager(caddy.ManagerConfig{
		Binary:    d.cfg.Caddy.Binary,
		AdminAddr: d.cfg.Caddy.AdminAddr,
		DataDir:   d.cfg.Caddy.DataDir,
	}, caddyLog)
	if err := d.caddy.Start(ctx); err != nil {
		caddyLog.Warn("traffic proxying unavailable", "error", err)
	} else {
		caddyLog.Info("child process started", "admin_addr", d.cfg.Caddy.AdminAddr)
	}

	// 5a. Start log ingester.
	socketPath := filepath.Join(d.cfg.DataDir, "trace.sock")
	samplingCfg := tracestore.SamplingConfig{
		Rate:            derefFloat64(d.cfg.Traces.Sampling.Rate, 1.0),
		ErrorsAlways:    d.cfg.Traces.Sampling.ErrorsAlways,
		AIAlways:        d.cfg.Traces.Sampling.AIAlways,
		SlowThresholdMS: derefInt(d.cfg.Traces.Sampling.MinDurationMS, 0),
	}
	d.ingester = tracestore.NewIngester(socketPath, d.ringBuffer, samplingCfg)
	if err := d.ingester.Start(ctx); err != nil {
		traceLog.Warn("ingester failed", "error", err)
	} else {
		traceLog.Info("ingester ready")
	}

	// 6. Start gRPC server.
	grpcAddr := d.cfg.Listen.GRPC
	if grpcAddr == "" {
		grpcAddr = ":7777"
	}
	grpcSrv, err := riokugrpc.NewServer(grpcAddr, d.engine, d.store, d.caddy, d.auth, d.ringBuffer, d.traceStore, grpcLog)
	if err != nil {
		grpcLog.Error("failed to start", "error", err)
	} else {
		d.grpc = grpcSrv
		go func() {
			if err := d.grpc.Start(); err != nil {
				grpcLog.Error("server error", "error", err)
			}
		}()
	}

	// 6a. Start the Caddy upstream-health poller (#122) when the
	// child process is up. The poller queries Caddy's
	// /reverse_proxy/upstreams admin endpoint on a fixed interval
	// and caches the snapshot for the gateway to expose. When Caddy
	// is unavailable we leave d.upstreamHealth nil so the REST
	// route returns "available: false" and the admin panel can
	// render a graceful empty state.
	if d.caddy != nil && d.caddy.IsRunning() {
		uhLog := slog.Default().With("component", "upstream-health")
		d.upstreamHealth = caddy.NewUpstreamHealthPoller(d.cfg.Caddy.AdminAddr, 5*time.Second, uhLog)
		d.upstreamHealth.Start(ctx)
		uhLog.Info("polling started", "admin_addr", d.cfg.Caddy.AdminAddr, "interval", "5s")
	}

	// 7. Start REST gateway on loopback (OS-assigned port).
	if d.grpc != nil {
		spaFS, err := riokuweb.SPA()
		if err != nil {
			slog.Warn("admin panel not available", "component", "web", "error", err)
		}

		basePort := d.cfg.Listen.InternalPort
		if basePort == 0 {
			basePort = 7780
		}
		var gw *gateway.Gateway
		for attempt := 0; attempt < 10; attempt++ {
			addr := fmt.Sprintf("127.0.0.1:%d", basePort+attempt)
			var uhSource gateway.UpstreamHealthSource
			if d.upstreamHealth != nil {
				uhSource = d.upstreamHealth
			}
			gw, err = gateway.NewGateway(addr, d.grpc.ConfigService(), d.grpc.HealthService(), d.grpc.TrafficService(), d.grpc.APIManagementService(), d.auth, d.sessions, d.engine, d.store, d.cfg, spaFS, d.ringBuffer, d.traceStore, uhSource, gwLog, d.logLevel)
			if err == nil {
				break
			}
			if attempt == 9 {
				gwLog.Error("failed to bind internal gateway", "port_range_start", basePort, "port_range_end", basePort+9, "error", err)
			}
		}
		if err != nil {
			gwLog.Error("failed to start", "error", err)
		} else {
			d.gateway = gw
			gwLog.Info("internal gateway bound", "addr", d.gateway.Addr())
			go func() {
				if err := d.gateway.Start(); err != nil {
					gwLog.Error("server error", "error", err)
				}
			}()
		}
	}

	// 7a. Start the on-demand TLS ask endpoint on loopback (#66). The
	// listener answers Caddy's automation `ask` calls during the TLS
	// handshake, allowing certificate issuance only for hosts that
	// match an enabled route. Without this gate an attacker could
	// drive ACME issuance for arbitrary domains pointed at the
	// gateway. The server is fail-safe: until SetSnapshot fires, the
	// matcher denies everything.
	tlsAskAddr := d.cfg.Listen.TLSAskAddr
	if tlsAskAddr == "" {
		tlsAskAddr = "127.0.0.1:7790"
	}
	if d.cfg.Caddy.OnDemandTLS {
		tlsAskLog := slog.Default().With("component", "tlsask")
		d.tlsAsk = tlsask.New()
		if err := d.tlsAsk.Listen(tlsAskAddr); err != nil {
			tlsAskLog.Error("listen failed — on-demand TLS will be DISABLED for safety", "addr", tlsAskAddr, "error", err)
			d.tlsAsk = nil
		} else {
			tlsAskLog.Info("listening", "addr", d.tlsAsk.Addr())
			// Seed the matcher from the current snapshot before serving so the
			// gate is correct from the very first handshake.
			if snap, err := d.engine.GetConfig(ctx); err != nil {
				tlsAskLog.Warn("initial snapshot fetch failed; deny-all matcher in effect until next change", "error", err)
			} else {
				d.tlsAsk.SetSnapshot(snap)
				exact, wild := d.tlsAsk.CurrentMatcher().Stats()
				tlsAskLog.Info("matcher seeded", "exact_hosts", exact, "wildcard_hosts", wild)
			}
			go func() {
				if err := d.tlsAsk.Serve(); err != nil && err.Error() != "http: Server closed" {
					tlsAskLog.Error("server error", "error", err)
				}
			}()
			// Refresh the matcher on every config change.
			go d.runTLSAskWatcher(ctx, tlsAskLog)
		}
	}

	// 8. Update compiler with the real admin config now that we know the gateway port.
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
	}, socketPath, nil, caddy.SecurityHeadersConfig{
		Enabled:             d.cfg.SecurityHeaders.Enabled,
		XContentTypeOptions: d.cfg.SecurityHeaders.XContentTypeOptions,
		XFrameOptions:       d.cfg.SecurityHeaders.XFrameOptions,
		ReferrerPolicy:      d.cfg.SecurityHeaders.ReferrerPolicy,
		PermissionsPolicy:   d.cfg.SecurityHeaders.PermissionsPolicy,
		CSP:                 d.cfg.SecurityHeaders.CSP,
		CSPReportOnly:       d.cfg.SecurityHeaders.CSPReportOnly,
		HSTS: caddy.HSTSConfig{
			Enabled:           d.cfg.SecurityHeaders.HSTS.Enabled,
			MaxAge:            d.cfg.SecurityHeaders.HSTS.MaxAge,
			IncludeSubdomains: d.cfg.SecurityHeaders.HSTS.IncludeSubdomains,
		},
	})
	if d.tlsAsk != nil {
		compiler.SetOnDemandTLS(caddy.OnDemandTLSConfig{
			Enabled: true,
			AskURL:  "http://" + d.tlsAsk.Addr() + "/tls/ask",
		})
	}
	d.engine.SetCompiler(compiler)
	slog.Info("compiler updated with admin config", "component", "config")

	// 8. Start sync agent (watches config changes, pushes to Caddy).
	d.syncAgent = riokusync.NewAgent(d.engine, d.caddy, syncLog)
	d.syncAgent.Start(ctx)

	// 8a. Start aggregator.
	if d.traceStore != nil {
		d.aggregator = tracestore.NewAggregator(d.ringBuffer, d.traceStore, 60*time.Second)
		d.aggregator.Start(ctx)
		traceLog.Info("aggregator ready")
	}

	// 9. Write PID file.
	if err := WritePIDFile(d.pidFile); err != nil {
		slog.Warn("failed to write pid file", "error", err)
	}

	slog.Info("daemon ready", "pid_file", d.pidFile)

	// 8. Block until context is cancelled (signal handler).
	<-ctx.Done()

	// 9. Graceful shutdown with a hard deadline so tests don't hang.
	stopCtx, stopCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer stopCancel()
	return d.Stop(stopCtx)
}

// Stop shuts down all subsystems in reverse order.
func (d *Daemon) Stop(ctx context.Context) error {
	slog.Info("shutting down")

	// Stop REST gateway.
	if d.gateway != nil {
		if err := d.gateway.Stop(ctx); err != nil {
			slog.Error("gateway stop error", "component", "gateway", "error", err)
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

	// Stop tlsask listener (#66).
	if d.tlsAsk != nil {
		if err := d.tlsAsk.Shutdown(); err != nil {
			slog.Error("tlsask shutdown error", "component", "tlsask", "error", err)
		}
	}

	// Stop upstream health poller (#122).
	if d.upstreamHealth != nil {
		d.upstreamHealth.Stop()
	}

	// Stop Caddy.
	if d.caddy != nil {
		if err := d.caddy.Stop(ctx); err != nil {
			slog.Error("caddy stop error", "component", "caddy", "error", err)
		}
	}

	// Stop aggregator.
	if d.aggregator != nil {
		d.aggregator.Stop()
	}

	// Stop ingester.
	if d.ingester != nil {
		d.ingester.Stop()
	}

	// Close trace store.
	if d.traceStore != nil {
		if err := d.traceStore.Close(); err != nil {
			slog.Error("tracestore close error", "component", "tracestore", "error", err)
		}
	}

	// Close store.
	if d.store != nil {
		if err := d.store.Close(); err != nil {
			slog.Error("store close error", "component", "store", "error", err)
		}
	}

	// Remove PID file.
	_ = RemovePIDFile(d.pidFile)

	// Flush and close the OTLP log exporter last so any shutdown log
	// messages above are still shipped before the connection is torn down.
	if d.loggingShutdown != nil {
		if err := d.loggingShutdown(ctx); err != nil {
			slog.Error("logging shutdown error", "component", "logging", "error", err)
		}
	}

	slog.Info("stopped")
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

// runTLSAskWatcher subscribes to config changes and refreshes the tlsask
// matcher on every event. The watcher debounces bursty changes (e.g. an
// import of many routes at once) to avoid rebuilding the matcher per
// route. The watcher exits when ctx is cancelled or the change channel
// closes (e.g. on store shutdown). Refresh is best-effort: a transient
// snapshot fetch failure leaves the previous matcher in place rather
// than wiping it (which would deny everything).
func (d *Daemon) runTLSAskWatcher(ctx context.Context, log *slog.Logger) {
	ch, err := d.engine.WatchChanges(ctx, 0)
	if err != nil {
		log.Error("watch changes failed; matcher will not refresh", "error", err)
		return
	}

	const debounceDur = 100 * time.Millisecond
	var debounce *time.Timer
	debounceC := func() <-chan time.Time {
		if debounce == nil {
			return nil
		}
		return debounce.C
	}
	pending := false

	for {
		select {
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
				debounce = time.NewTimer(debounceDur)
			} else {
				if !debounce.Stop() {
					select {
					case <-debounce.C:
					default:
					}
				}
				debounce.Reset(debounceDur)
			}
			pending = true
		case <-debounceC():
			if !pending {
				continue
			}
			pending = false
			snap, err := d.engine.GetConfig(ctx)
			if err != nil {
				log.Warn("snapshot fetch failed; matcher unchanged", "error", err)
				continue
			}
			d.tlsAsk.SetSnapshot(snap)
			exact, wild := d.tlsAsk.CurrentMatcher().Stats()
			log.Debug("matcher refreshed", "exact_hosts", exact, "wildcard_hosts", wild)
		}
	}
}

// derefFloat64 returns *p if non-nil, otherwise def.
func derefFloat64(p *float64, def float64) float64 {
	if p != nil {
		return *p
	}
	return def
}

// derefInt returns *p if non-nil, otherwise def.
func derefInt(p *int, def int) int {
	if p != nil {
		return *p
	}
	return def
}
