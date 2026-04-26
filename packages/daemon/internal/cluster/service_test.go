package cluster

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestLocalOnlyService_ListReturnsSelf(t *testing.T) {
	svc := NewLocalOnlyService(LocalOnlyConfig{
		NodeID:        "id-1",
		NodeName:      "alpha",
		DaemonVersion: "1.0.0",
		StoreMode:     "sqlite",
	})
	nodes, err := svc.ListNodes(context.Background())
	if err != nil {
		t.Fatalf("ListNodes: %v", err)
	}
	if len(nodes) != 1 {
		t.Fatalf("expected 1 node, got %d", len(nodes))
	}
	n := nodes[0]
	if n.ID != "id-1" || n.Name != "alpha" {
		t.Errorf("identity wrong: %+v", n)
	}
	if !n.IsSelf || !n.IsLeader {
		t.Errorf("expected IsSelf+IsLeader, got %+v", n)
	}
	if n.Health != HealthHealthy || n.Role != RoleBootstrap {
		t.Errorf("expected healthy bootstrap, got %+v", n)
	}
	if _, ok := n.Metrics["uptime_seconds"]; !ok {
		t.Errorf("expected uptime_seconds metric, got %v", n.Metrics)
	}
}

func TestLocalOnlyService_DefaultsHostname(t *testing.T) {
	svc := NewLocalOnlyService(LocalOnlyConfig{DaemonVersion: "x"})
	nodes, _ := svc.ListNodes(context.Background())
	if nodes[0].Name == "" {
		t.Error("expected hostname default for empty NodeName")
	}
	if nodes[0].ID != nodes[0].Name {
		t.Errorf("expected ID to default to Name, got %s vs %s", nodes[0].ID, nodes[0].Name)
	}
}

func TestLocalOnlyService_RemoveAlwaysFails(t *testing.T) {
	svc := NewLocalOnlyService(LocalOnlyConfig{NodeID: "self"})
	err := svc.RemoveNode(context.Background(), "self")
	if err == nil {
		t.Fatal("expected error from single-node RemoveNode")
	}
	if !strings.Contains(err.Error(), "single-node") {
		t.Errorf("expected single-node mention, got %v", err)
	}
}

func TestLocalOnlyService_ForceSyncWithoutHook(t *testing.T) {
	svc := NewLocalOnlyService(LocalOnlyConfig{})
	res, err := svc.ForceSync(context.Background())
	if err != nil {
		t.Fatalf("ForceSync: %v", err)
	}
	if res.PushedToCaddy {
		t.Error("expected PushedToCaddy=false when no hook")
	}
	if !strings.Contains(res.Note, "no Caddy hook") {
		t.Errorf("expected note explanation, got %q", res.Note)
	}
}

func TestLocalOnlyService_ForceSyncWithHook(t *testing.T) {
	calls := 0
	svc := NewLocalOnlyService(LocalOnlyConfig{
		CaddyReload: func(_ context.Context) error {
			calls++
			return nil
		},
	})
	res, err := svc.ForceSync(context.Background())
	if err != nil {
		t.Fatalf("ForceSync: %v", err)
	}
	if !res.PushedToCaddy {
		t.Error("expected PushedToCaddy=true")
	}
	if calls != 1 {
		t.Errorf("expected 1 hook call, got %d", calls)
	}
}

func TestLocalOnlyService_ForceSyncHookError(t *testing.T) {
	hookErr := errors.New("boom")
	svc := NewLocalOnlyService(LocalOnlyConfig{
		CaddyReload: func(_ context.Context) error {
			return hookErr
		},
	})
	_, err := svc.ForceSync(context.Background())
	if err == nil {
		t.Fatal("expected error when hook fails")
	}
	if !errors.Is(err, hookErr) {
		t.Errorf("expected wrapped hook error, got %v", err)
	}
}
