// Package gateway implements the REST gateway that translates
// HTTP+JSON to gRPC using grpc-gateway. It is a thin translation
// layer with no business logic. gRPC streams are translated to SSE.
package gateway

import (
	"context"
	"fmt"
	"log"
	"net/http"

	"github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/config"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
)

// Gateway wraps an HTTP server that serves the REST API.
type Gateway struct {
	httpServer *http.Server
	addr       string
}

// NewGateway creates a REST gateway that translates HTTP+JSON to gRPC.
func NewGateway(
	addr string,
	configSvc riokuv1.ConfigServiceServer,
	healthSvc riokuv1.HealthServiceServer,
	a *auth.Auth,
	engine *config.Engine,
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

	// Build the HTTP handler chain.
	topMux := http.NewServeMux()

	// Auth routes (unauthenticated).
	RegisterAuthRoutes(topMux, a)

	// SSE routes (auth checked per-path in middleware).
	RegisterSSERoutes(topMux, engine)

	// grpc-gateway handles everything else under /api/v1/.
	topMux.Handle("/", gwMux)

	// Apply middleware stack (outermost first).
	var handler http.Handler = topMux
	handler = AuthMiddleware(a)(handler)
	handler = RequestIDMiddleware(handler)

	return &Gateway{
		httpServer: &http.Server{
			Addr:    addr,
			Handler: handler,
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
