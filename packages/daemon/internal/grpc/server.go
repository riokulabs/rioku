// Package grpc implements the internal gRPC server that exposes
// ConfigService, PluginService, BuildService, ClusterService,
// HealthService, and TrafficService.
package grpc

import (
	"fmt"
	"log"
	"net"

	"github.com/riokulabs/rioku/internal/caddy"
	"github.com/riokulabs/rioku/internal/config"
	"github.com/riokulabs/rioku/internal/store"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/reflection"
)

// Server wraps a gRPC server with registered Rioku services.
type Server struct {
	grpcServer *grpc.Server
	listener   net.Listener
	addr       string
}

// NewServer creates a gRPC server with ConfigService and HealthService registered.
func NewServer(addr string, engine *config.Engine, st store.Driver, caddyMgr *caddy.Manager) (*Server, error) {
	lis, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("grpc: listen %s: %w", addr, err)
	}

	gs := grpc.NewServer()

	riokuv1.RegisterConfigServiceServer(gs, newConfigService(engine))
	riokuv1.RegisterHealthServiceServer(gs, newHealthService(st, caddyMgr))

	// Enable reflection for grpcurl and debugging.
	reflection.Register(gs)

	return &Server{
		grpcServer: gs,
		listener:   lis,
		addr:       addr,
	}, nil
}

// Start begins serving gRPC requests. Blocks until Stop is called.
func (s *Server) Start() error {
	log.Printf("grpc: listening on %s", s.addr)
	return s.grpcServer.Serve(s.listener)
}

// Stop gracefully stops the gRPC server.
func (s *Server) Stop() {
	log.Println("grpc: stopping...")
	s.grpcServer.GracefulStop()
}
