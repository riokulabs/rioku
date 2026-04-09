// Package grpc implements the internal gRPC server that exposes
// ConfigService, PluginService, BuildService, ClusterService,
// HealthService, and TrafficService.
package grpc

import (
	"fmt"
	"log"
	"net"
	"time"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/caddy"
	"github.com/riokulabs/rioku/internal/config"
	"github.com/riokulabs/rioku/internal/store"
	"github.com/riokulabs/rioku/internal/tracestore"
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
	trafficSvc riokuv1.TrafficServiceServer
}

// NewServer creates a gRPC server with ConfigService, HealthService, and
// optionally TrafficService registered.
func NewServer(addr string, engine *config.Engine, st store.Driver, caddyMgr *caddy.Manager, a *auth.Auth, traceBuf *tracestore.RingBuffer, traceStore tracestore.Driver) (*Server, error) {
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

	var trafficSvc riokuv1.TrafficServiceServer
	if traceBuf != nil && traceStore != nil {
		trafficSvc = newTrafficService(traceBuf, traceStore)
		riokuv1.RegisterTrafficServiceServer(gs, trafficSvc)
	}

	// Enable reflection for grpcurl and debugging.
	reflection.Register(gs)

	return &Server{
		grpcServer: gs,
		listener:   lis,
		addr:       addr,
		configSvc:  cfgSvc,
		healthSvc:  healthSvc,
		trafficSvc: trafficSvc,
	}, nil
}

// Start begins serving gRPC requests. Blocks until Stop is called.
func (s *Server) Start() error {
	log.Printf("grpc: listening on %s", s.addr)
	return s.grpcServer.Serve(s.listener)
}

// Stop gracefully stops the gRPC server with a 5-second deadline,
// falling back to a hard stop if active streams don't drain in time.
func (s *Server) Stop() {
	log.Println("grpc: stopping...")
	done := make(chan struct{})
	go func() {
		s.grpcServer.GracefulStop()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		log.Println("grpc: graceful stop timed out, forcing stop")
		s.grpcServer.Stop()
	}
}

// ConfigService returns the registered ConfigService server implementation.
func (s *Server) ConfigService() riokuv1.ConfigServiceServer { return s.configSvc }

// HealthService returns the registered HealthService server implementation.
func (s *Server) HealthService() riokuv1.HealthServiceServer { return s.healthSvc }

// TrafficService returns the registered TrafficService server implementation,
// or nil if the tracestore was not configured.
func (s *Server) TrafficService() riokuv1.TrafficServiceServer { return s.trafficSvc }
