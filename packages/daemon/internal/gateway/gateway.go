// Package gateway implements the REST gateway that translates
// HTTP+JSON to gRPC using grpc-gateway. It is a thin translation
// layer with no business logic. gRPC streams are translated to SSE.
package gateway

import (
	"context"
	"fmt"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	goruntime "runtime"
	"time"

	"github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/caddy"
	"github.com/riokulabs/rioku/internal/cluster"
	"github.com/riokulabs/rioku/internal/config"
	"github.com/riokulabs/rioku/internal/observability"
	"github.com/riokulabs/rioku/internal/store"
	"github.com/riokulabs/rioku/internal/tracestore"
	"github.com/riokulabs/rioku/internal/version"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
)

// totpEncryptionSalt is the HKDF salt used to derive the TOTP encryption key
// from the daemon's JWT signing key. It is fixed so the derived key is stable
// across daemon restarts.
var totpEncryptionSalt = []byte("rioku-totp-encryption-salt-v1")

// Gateway wraps an HTTP server that serves the REST API.
type Gateway struct {
	httpServer  *http.Server
	listener    net.Listener
	addr        string // resolved address, e.g. "127.0.0.1:54321"
	rateLimiter *RateLimiter
	log         *slog.Logger
}

// NewGateway creates a REST gateway that translates HTTP+JSON to gRPC.
// If spaFS is non-nil, the admin panel SPA is served at /.
//
// `levelVar` is the slog.LevelVar returned by logging.Setup — passing it
// through enables PATCH /api/v1/settings/general to change the daemon log
// level at runtime. Pass nil to disable runtime log-level updates.
func NewGateway(
	addr string,
	configSvc riokuv1.ConfigServiceServer,
	healthSvc riokuv1.HealthServiceServer,
	trafficSvc riokuv1.TrafficServiceServer,
	apiMgmtSvc riokuv1.APIManagementServiceServer,
	aiGatewaySvc riokuv1.AIGatewayServiceServer,
	wafSvc riokuv1.WAFServiceServer,
	a *auth.Auth,
	sm *auth.SessionManager,
	engine *config.Engine,
	st store.Driver,
	cfg *config.Config,
	spaFS fs.FS,
	traceBuf *tracestore.RingBuffer,
	traceStore tracestore.Driver,
	upstreamHealth UpstreamHealthSource,
	jwksRegistry *observability.JWKSRegistry,
	logTail *LogTailBuffer,
	logger *slog.Logger,
	levelVar *slog.LevelVar,
) (*Gateway, error) {
	if cfg == nil {
		return nil, fmt.Errorf("gateway: cfg is required")
	}
	ctx := context.Background()

	// Create grpc-gateway mux with custom error handler.
	gwMux := runtime.NewServeMux(
		runtime.WithErrorHandler(ErrorHandler),
	)

	// Register generated handlers (in-process, no gRPC connection needed).
	if err := riokuv1.RegisterConfigServiceHandlerServer(ctx, gwMux, configSvc); err != nil {
		return nil, fmt.Errorf("register config service: %w", err)
	}
	if err := riokuv1.RegisterHealthServiceHandlerServer(ctx, gwMux, healthSvc); err != nil {
		return nil, fmt.Errorf("register health service: %w", err)
	}
	if trafficSvc != nil {
		if err := riokuv1.RegisterTrafficServiceHandlerServer(ctx, gwMux, trafficSvc); err != nil {
			return nil, fmt.Errorf("register traffic service: %w", err)
		}
	}
	if apiMgmtSvc != nil {
		if err := riokuv1.RegisterAPIManagementServiceHandlerServer(ctx, gwMux, apiMgmtSvc); err != nil {
			return nil, fmt.Errorf("register api-management service: %w", err)
		}
	}
	if aiGatewaySvc != nil {
		if err := riokuv1.RegisterAIGatewayServiceHandlerServer(ctx, gwMux, aiGatewaySvc); err != nil {
			return nil, fmt.Errorf("register ai-gateway service: %w", err)
		}
	}
	if wafSvc != nil {
		if err := riokuv1.RegisterWAFServiceHandlerServer(ctx, gwMux, wafSvc); err != nil {
			return nil, fmt.Errorf("register waf service: %w", err)
		}
	}

	// Derive the TOTP encryption key from the signing key.
	signingKey := a.SigningKey()
	encKey, err := auth.DeriveEncryptionKey(signingKey, totpEncryptionSalt)
	if err != nil {
		return nil, fmt.Errorf("derive TOTP encryption key: %w", err)
	}
	enc, err := auth.NewEncryptor(encKey)
	if err != nil {
		return nil, fmt.Errorf("create TOTP encryptor: %w", err)
	}

	// Build the HTTP handler chain.
	topMux := http.NewServeMux()

	// OpenAPI spec (unauthenticated; compile-time embed with ETag caching).
	RegisterOpenAPIRoute(topMux)

	// PromQL proxy with tenant label injection.
	RegisterPromQLRoutes(topMux, st)

	// Dashboard widget query engine (#236).
	RegisterWidgetQueryRoutes(topMux, st)

	// Opaque-handle store: PII → short token mapping.
	RegisterOpaqueRoutes(topMux, st)

	// Auth routes (unauthenticated).
	RegisterAuthRoutes(topMux, a, sm, st, cfg, enc)

	// Bootstrap routes — GET /bootstrap-status + POST /bootstrap (unauthenticated).
	RegisterBootstrapRoutes(topMux, st, sm, cfg)

	// Password reset routes — request/validate/apply (unauthenticated).
	// BaseURL for reset links defaults to the configured public URL; callers
	// that know the real public URL should override via NewGateway options in
	// a future refactor. For now a sensible localhost default is used.
	resetBaseURL := cfg.Auth.PublicURL
	if resetBaseURL == "" {
		resetBaseURL = "http://localhost:7778"
	}
	// Construct outbound mailer from config: SMTP when host is configured,
	// nop otherwise (silently discards messages).
	var outboundMailer auth.Mailer
	if cfg.Auth.SMTP.Host != "" {
		outboundMailer = auth.NewSMTPMailer(auth.MailerConfig{
			Host:     cfg.Auth.SMTP.Host,
			Port:     cfg.Auth.SMTP.Port,
			From:     cfg.Auth.SMTP.From,
			Username: cfg.Auth.SMTP.Username,
			Password: cfg.Auth.SMTP.Password,
			StartTLS: cfg.Auth.SMTP.StartTLS,
		})
	} else {
		outboundMailer = auth.NewNopMailer()
	}
	RegisterPasswordResetRoutes(topMux, st, outboundMailer, cfg, resetBaseURL)

	// Invite routes — POST /t/{tenant}/users/invite + POST /auth/invite/accept (unauthenticated accept).
	RegisterInviteRoutes(topMux, st, sm, outboundMailer, cfg)

	// Key management routes.
	RegisterKeyRoutes(topMux, st)

	// RBAC management routes (permission-gated).
	RegisterRBACRoutes(topMux, st)

	// User management routes (permission-gated).
	RegisterUserRoutes(topMux, st, sm, cfg)

	// TOTP management routes.
	RegisterTOTPRoutes(topMux, st, a, sm, enc)

	// SSE routes for live config change and traffic trace streams.
	RegisterSSERoutes(topMux, engine, traceBuf)

	// Audit log endpoint (hand-written because gRPC-gateway cannot
	// translate server-streaming RPCs in in-process mode).
	RegisterAuditRoutes(topMux, st)
	// Audit detail / stream / export / typeahead.
	RegisterAuditExtraRoutes(topMux, st)

	// Access policy CRUD (#80) — includes test-cel endpoint.
	RegisterAccessPolicyRoutes(topMux, st)

	// Settings endpoints (replaces old monolithic GET /api/v1/settings stub).
	runtimeSettings := NewRuntimeSettings(cfg, levelVar)
	RegisterSettingsRoutes(topMux, cfg, st, time.Now().UTC(), runtimeSettings)

	// Traffic analytics endpoints.
	RegisterTrafficRoutes(topMux, engine, traceStore)

	// Cluster management — single-node default. Real multi-node Discovery
	// gets swapped in once #57 lands.
	clusterSvc := cluster.NewLocalOnlyService(cluster.LocalOnlyConfig{
		DaemonVersion: version.Version,
		GoVersion:     goruntime.Version(),
		StoreMode:     cfg.Store.Driver,
		// CaddyReload is wired up at the daemon layer when ForceSync is
		// supposed to reload the local Caddy admin config.
	})
	RegisterClusterRoutes(topMux, clusterSvc)

	// Certificate management (#84). Stub-backed — real Caddy filesystem
	// scan + admin-API renew/revoke lands alongside #77.
	certSvc := caddy.NewStubCertService()
	RegisterCertificateRoutes(topMux, certSvc)

	// Upstream health snapshot (#122). Source may be nil when Caddy
	// isn't running — the handler returns an "unavailable" payload
	// rather than 404 so the admin panel can render an empty state.
	RegisterUpstreamHealthRoutes(topMux, upstreamHealth)

	// JWKS rotation observability (#191). Registry may be nil when
	// no rioku_jwt route is configured — handler returns an empty
	// "unavailable" payload in that case.
	RegisterObservabilityRoutes(topMux, jwksRegistry, logTail)

	// Tenant + membership management.
	RegisterTenantRoutes(topMux, st)
	// Tenant identity resolver — lean {id, slug, name, parentDomain?}
	// for any caller already authenticated within the tenant.
	RegisterTenantIdentityRoutes(topMux, st)

	// Sites + Middlewares.
	RegisterSiteRoutes(topMux, st)
	RegisterMiddlewareRoutes(topMux, st)

	// Tenant-scoped Services + Routes. These coexist with the legacy
	// gRPC-gateway-derived `/api/v1/services` and `/api/v1/routes` paths,
	// which keep working for the default tenant via
	// `store.TenantIDFromContext`'s fallback.
	RegisterServicesRoutes(topMux, st)
	RegisterRoutesRoutes(topMux, st)
	RegisterRouteMiddlewareOrderRoutes(topMux, st)

	// RBAC policies: subject ↔ role mappings per tenant.
	RegisterRbacPolicyRoutes(topMux, st)

	// Extras: notifications stream + channel test, PKI/TLS PATCH/OPTIONS,
	// webhook test, tenant-scoped cluster aliases, settings singleton
	// OPTIONS coverage.
	RegisterStage2ExtrasRoutes(topMux, st)

	// Finals: plugins install alias, /settings/me profile family,
	// super-admin surface, auth flow recovery, danger-zone.
	if cfg.DataDir != "" {
		SetPluginStagingDir(cfg.DataDir)
	}
	SetCapabilities(cfg)
	RegisterStage2FinalsRoutes(topMux, st)

	// Dashboards + Widgets + Versions.
	RegisterDashboardRoutes(topMux, st)

	// AI subsystem: providers, agents, tools, bindings, rate limits, traces, MCP.
	RegisterAIRoutes(topMux, st)
	// AI PATCH / OPTIONS / actions / sub-collections / traces stream + export.
	RegisterAIExtraRoutes(topMux, st)

	// Notifications subsystem: inbox, channels, routing, delivery log, tenant config.
	RegisterNotificationsRoutes(topMux, st)

	// SSO providers (#240): per-tenant CRUD for OIDC/SAML configs.
	RegisterSsoRoutes(topMux, st)

	// Plugins + PluginSigners: per-tenant + global scopes.
	RegisterPluginRoutes(topMux, st)

	// PKI/TLS: CAs, enrollments, certificates, config.
	RegisterPKIRoutes(topMux, st)

	// Manual TLS cert PEM upload + delete.
	RegisterSettingsTLSRoutes(topMux, st)
	// PKI revocation list + create endpoints.
	RegisterSettingsPKIRoutes(topMux, st)

	// Settings config singletons: network, auth-policy, observability, audit retention.
	RegisterSettingsConfigRoutes(topMux, st)

	// Webhooks + Cluster enrollment + Impersonation.
	RegisterWebhooksClusterImpersonationRoutes(topMux, st)

	// Remaining stub routes for endpoints the frontend calls but that
	// don't have real implementations yet (plugins). Cluster moved to
	// RegisterClusterRoutes above.
	RegisterStubRoutes(topMux, cfg)

	// grpc-gateway handles API routes.
	topMux.Handle("/api/", gwMux)

	// Serve admin panel SPA at / (if built).
	if spaFS != nil {
		topMux.Handle("/", newSPAHandler(spaFS))
	} else {
		topMux.Handle("/", gwMux)
	}

	// Apply middleware stack (outermost first).
	// Order: RequestID → Auth → Tenant → RateLimit → CORS → SecurityHeaders → handler
	// RequestID is outermost (always applied). Auth extracts identity. Tenant
	// resolves /api/v1/t/{slug}/... once identity is known so we don't hit
	// the store on unauthenticated requests. RateLimit needs auth context for
	// session/user keying. CORS handles preflight before the handler runs.
	// SecurityHeaders is innermost (closest to response).
	var handler http.Handler = topMux
	handler = SecurityHeadersMiddleware(handler)
	handler = CORSMiddleware(cfg.Auth.CORS)(handler)
	rl := NewRateLimiter(cfg.Auth.RateLimit)
	handler = rl.Middleware()(handler)
	handler = TenantMiddleware(st)(handler)
	handler = AuthMiddleware(a, sm)(handler)
	handler = RequestIDMiddleware(handler)

	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("gateway: listen %s: %w", addr, err)
	}

	return &Gateway{
		httpServer: &http.Server{
			Handler:      handler,
			ReadTimeout:  15 * time.Second,
			WriteTimeout: 60 * time.Second, // longer for SSE streams
			IdleTimeout:  120 * time.Second,
		},
		listener:    ln,
		addr:        ln.Addr().String(),
		rateLimiter: rl,
		log:         logger,
	}, nil
}

// Addr returns the resolved listen address (e.g. "127.0.0.1:54321").
// Safe to call immediately after NewGateway.
func (g *Gateway) Addr() string {
	return g.addr
}

// Start begins serving HTTP requests. Blocks until Stop is called.
func (g *Gateway) Start() error {
	g.log.Info("listening", "addr", g.addr)
	err := g.httpServer.Serve(g.listener)
	if err == http.ErrServerClosed {
		return nil
	}
	return err
}

// Stop gracefully shuts down the HTTP server and background goroutines.
func (g *Gateway) Stop(ctx context.Context) error {
	g.log.Info("stopping")
	if g.rateLimiter != nil {
		g.rateLimiter.Stop()
	}
	return g.httpServer.Shutdown(ctx)
}
