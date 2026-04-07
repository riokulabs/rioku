package grpc

import (
	"context"

	"github.com/riokulabs/rioku/internal/caddy"
	"github.com/riokulabs/rioku/internal/store"
	"github.com/riokulabs/rioku/internal/version"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type healthService struct {
	riokuv1.UnimplementedHealthServiceServer
	store    store.Driver
	caddyMgr *caddy.Manager
}

func newHealthService(st store.Driver, caddyMgr *caddy.Manager) *healthService {
	return &healthService{
		store:    st,
		caddyMgr: caddyMgr,
	}
}

func (s *healthService) GetHealth(ctx context.Context, req *riokuv1.HealthRequest) (*riokuv1.HealthStatus, error) {
	overall := riokuv1.HealthState_HEALTH_STATE_OK

	// Store health.
	storeHealth := s.store.Health(ctx)
	storeState := riokuv1.HealthState_HEALTH_STATE_OK
	if !storeHealth.OK {
		storeState = riokuv1.HealthState_HEALTH_STATE_UNHEALTHY
		overall = riokuv1.HealthState_HEALTH_STATE_DEGRADED
	}
	storeSubsystem := &riokuv1.SubsystemHealth{
		State:  storeState,
		Detail: storeHealth.Details,
	}

	// Caddy health.
	caddyState := riokuv1.HealthState_HEALTH_STATE_UNHEALTHY
	caddyMsg := "not running"
	if s.caddyMgr != nil && s.caddyMgr.IsRunning() {
		if err := s.caddyMgr.Health(ctx); err != nil {
			caddyState = riokuv1.HealthState_HEALTH_STATE_DEGRADED
			caddyMsg = err.Error()
			if overall == riokuv1.HealthState_HEALTH_STATE_OK {
				overall = riokuv1.HealthState_HEALTH_STATE_DEGRADED
			}
		} else {
			caddyState = riokuv1.HealthState_HEALTH_STATE_OK
			caddyMsg = "running"
		}
	} else if overall == riokuv1.HealthState_HEALTH_STATE_OK {
		overall = riokuv1.HealthState_HEALTH_STATE_DEGRADED
	}
	caddySubsystem := &riokuv1.SubsystemHealth{
		State:   caddyState,
		Message: caddyMsg,
	}

	return &riokuv1.HealthStatus{
		Overall:   overall,
		Store:     storeSubsystem,
		Caddy:     caddySubsystem,
		Version:   version.Version,
		CheckedAt: timestamppb.Now(),
	}, nil
}

func (s *healthService) GetCaddyStatus(ctx context.Context, req *riokuv1.CaddyStatusRequest) (*riokuv1.CaddyStatus, error) {
	cs := &riokuv1.CaddyStatus{
		CheckedAt: timestamppb.Now(),
	}

	if s.caddyMgr == nil || !s.caddyMgr.IsRunning() {
		cs.State = riokuv1.HealthState_HEALTH_STATE_UNHEALTHY
		cs.Running = false
		return cs, nil
	}

	cs.Running = true
	if err := s.caddyMgr.Health(ctx); err != nil {
		cs.State = riokuv1.HealthState_HEALTH_STATE_DEGRADED
	} else {
		cs.State = riokuv1.HealthState_HEALTH_STATE_OK
	}

	return cs, nil
}

var _ riokuv1.HealthServiceServer = (*healthService)(nil)
