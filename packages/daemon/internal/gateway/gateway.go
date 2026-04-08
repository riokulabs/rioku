// Package gateway implements the REST gateway that translates
// HTTP+JSON to gRPC using grpc-gateway. It is a thin translation
// layer with no business logic. gRPC streams are translated to SSE.
package gateway

import (
	"context"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"time"

	"github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/config"
	"github.com/riokulabs/rioku/internal/store"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
)

// totpEncryptionSalt is the HKDF salt used to derive the TOTP encryption key
// from the daemon's JWT signing key. It is fixed so the derived key is stable
// across daemon restarts.
var totpEncryptionSalt = []byte("rioku-totp-encryption-salt-v1")

// Gateway wraps an HTTP server that serves the REST API.
type Gateway struct {
	httpServer *http.Server
	addr       string
}

// NewGateway creates a REST gateway that translates HTTP+JSON to gRPC.
// If spaFS is non-nil, the admin panel SPA is served at /.
func NewGateway(
	addr string,
	configSvc riokuv1.ConfigServiceServer,
	healthSvc riokuv1.HealthServiceServer,
	a *auth.Auth,
	sm *auth.SessionManager,
	engine *config.Engine,
	st store.Driver,
	cfg *config.Config,
	spaFS fs.FS,
) (*Gateway, error) {
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

	// Auth routes (unauthenticated).
	RegisterAuthRoutes(topMux, a, sm, st, cfg, enc)

	// Key management routes.
	RegisterKeyRoutes(topMux, st)

	// RBAC management routes (permission-gated).
	RegisterRBACRoutes(topMux, st)

	// TOTP management routes.
	RegisterTOTPRoutes(topMux, st, a, sm, enc)

	// SSE routes.
	RegisterSSERoutes(topMux, engine)

	// grpc-gateway handles API routes.
	topMux.Handle("/api/", gwMux)

	// Serve admin panel SPA at / (if built).
	if spaFS != nil {
		topMux.Handle("/", newSPAHandler(spaFS))
	} else {
		topMux.Handle("/", gwMux)
	}

	// Apply middleware stack (outermost first).
	var handler http.Handler = topMux
	handler = AuthMiddleware(a, sm)(handler)
	handler = RequestIDMiddleware(handler)

	return &Gateway{
		httpServer: &http.Server{
			Addr:         addr,
			Handler:      handler,
			ReadTimeout:  15 * time.Second,
			WriteTimeout: 60 * time.Second, // longer for SSE streams
			IdleTimeout:  120 * time.Second,
		},
		addr: addr,
	}, nil
}

// Start begins serving HTTP requests. Blocks until Stop is called.
func (g *Gateway) Start() error {
	log.Printf("rest: listening on %s", g.addr)
	err := g.httpServer.ListenAndServe()
	if err == http.ErrServerClosed {
		return nil
	}
	return err
}

// Stop gracefully shuts down the HTTP server.
func (g *Gateway) Stop(ctx context.Context) error {
	log.Println("rest: stopping...")
	return g.httpServer.Shutdown(ctx)
}
