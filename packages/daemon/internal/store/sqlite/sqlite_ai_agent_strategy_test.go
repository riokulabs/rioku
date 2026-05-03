package sqlite_test

import (
	"testing"

	"github.com/google/uuid"

	"github.com/riokulabs/rioku/internal/store"
	_ "github.com/riokulabs/rioku/internal/store/sqlite"
)

func TestAIAgent_RoutingStrategyDefaults(t *testing.T) {
	d, close := openTempStore(t)
	defer close()
	ctx := tenantCtx(t)
	tx, _ := d.Begin(ctx, store.TxOptions{})
	defer tx.Rollback() //nolint:errcheck

	a, err := tx.CreateAIAgent(ctx, &store.AIAgent{
		ID:       "agent_" + uuid.NewString(),
		TenantID: "tenant_default",
		Name:     "default-routing-" + uuid.NewString()[:6],
		Enabled:  true,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if a.RoutingStrategy != "fallback" {
		t.Errorf("RoutingStrategy default = %q, want fallback", a.RoutingStrategy)
	}
	if a.RoutingConfig != "{}" {
		t.Errorf("RoutingConfig default = %q, want {}", a.RoutingConfig)
	}
}

func TestAIAgent_RoutingStrategyRoundTrip(t *testing.T) {
	d, close := openTempStore(t)
	defer close()
	ctx := tenantCtx(t)
	tx, _ := d.Begin(ctx, store.TxOptions{})
	defer tx.Rollback() //nolint:errcheck

	a, err := tx.CreateAIAgent(ctx, &store.AIAgent{
		ID:              "agent_" + uuid.NewString(),
		TenantID:        "tenant_default",
		Name:            "explicit-strategy-" + uuid.NewString()[:6],
		Enabled:         true,
		RoutingStrategy: "latency",
		RoutingConfig:   `{"decay":0.7}`,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	got, err := tx.GetAIAgent(ctx, "tenant_default", a.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.RoutingStrategy != "latency" {
		t.Errorf("RoutingStrategy = %q, want latency", got.RoutingStrategy)
	}
	if got.RoutingConfig != `{"decay":0.7}` {
		t.Errorf("RoutingConfig = %q, want decay JSON", got.RoutingConfig)
	}
}

func TestAIAgent_UpdateRoutingStrategy(t *testing.T) {
	d, close := openTempStore(t)
	defer close()
	ctx := tenantCtx(t)
	tx, _ := d.Begin(ctx, store.TxOptions{})
	defer tx.Rollback() //nolint:errcheck

	a, err := tx.CreateAIAgent(ctx, &store.AIAgent{
		ID:       "agent_" + uuid.NewString(),
		TenantID: "tenant_default",
		Name:     "update-target-" + uuid.NewString()[:6],
		Enabled:  true,
	})
	if err != nil {
		t.Fatal(err)
	}
	newStrategy := "simple_shuffle"
	newCfg := `{"weight_floor":1}`
	updated, err := tx.UpdateAIAgent(ctx, "tenant_default", a.ID, store.UpdateAIAgentParams{
		RoutingStrategy: &newStrategy,
		RoutingConfig:   &newCfg,
	})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if updated.RoutingStrategy != "simple_shuffle" || updated.RoutingConfig != newCfg {
		t.Errorf("update lost: strategy=%q config=%q", updated.RoutingStrategy, updated.RoutingConfig)
	}
	// Untouched fields preserved.
	if updated.Name != a.Name {
		t.Errorf("Name lost on partial update: %q != %q", updated.Name, a.Name)
	}
}
