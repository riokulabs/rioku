// Package grpc implements the internal gRPC server that exposes
// ConfigService, PluginService, BuildService, ClusterService,
// HealthService, and TrafficService.
package grpc

import (
	"fmt"
	"log"
	"net"

	"github.com/riokulabs/rioku/internal/auth"
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
	configSvc  riokuv1.ConfigServiceServer
	healthSvc  riokuv1.HealthServiceServer
}

// NewServer creates a gRPC server with ConfigService and HealthService registered.
func NewServer(addr string, engine *config.Engine, st store.Driver, caddyMgr *caddy.Manager, a *auth.Auth) (*Server, error) {
	lis, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("grpc: listen %s: %w", addr, err)
	}

	var opts []grpc.ServerOption
	if a != nil {
		opts = append(opts,
			grpc.UnaryInterceptor(UnaryAuthInterceptor(a)),
			grpc.StreamInterceptor(StreamAuthInterceptor(a)),
		)
	}
	gs := grpc.NewServer(opts...)

	cfgSvc := newConfigService(engine)
	healthSvc := newHealthService(st, caddyMgr)

	riokuv1.RegisterConfigServiceServer(gs, cfgSvc)
	riokuv1.RegisterHealthServiceServer(gs, healthSvc)

	// Enable reflection for grpcurl and debugging.
	reflection.Register(gs)

	return &Server{
		grpcServer: gs,
		listener:   lis,
		addr:       addr,
		configSvc:  cfgSvc,
		healthSvc:  healthSvc,
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

// ConfigService returns the registered ConfigService server implementation.
func (s *Server) ConfigService() riokuv1.ConfigServiceServer { return s.configSvc }

// HealthService returns the registered HealthService server implementation.
func (s *Server) HealthService() riokuv1.HealthServiceServer { return s.healthSvc }
