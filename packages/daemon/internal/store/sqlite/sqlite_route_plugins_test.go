package sqlite_test

import (
	"errors"
	"testing"

	"github.com/google/uuid"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"

	"github.com/riokulabs/rioku/internal/store"
	_ "github.com/riokulabs/rioku/internal/store/sqlite"
)

// createTestRoute is a minimal route fixture for the per-route
// plugin tests. CreateRoute generates the id itself; we return
// what it persisted.
func createTestRoute(t *testing.T, d store.Driver) string {
	t.Helper()
	ctx := tenantCtx(t)
	tx, _ := d.Begin(ctx, store.TxOptions{})
	created, err := tx.CreateRoute(ctx, &riokuv1.Route{
		Name: "test-" + uuid.NewString()[:8],
		Target: &riokuv1.Route_Upstream{
			Upstream: &riokuv1.DirectUpstream{Address: "127.0.0.1:9999"},
		},
		Enabled: true,
	})
	if err != nil {
		_ = tx.Rollback()
		t.Fatalf("CreateRoute: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	return created.GetId()
}

func TestRouteOASConfig_UpsertGetDelete(t *testing.T) {
	d, close := openTempStore(t)
	defer close()
	routeID := createTestRoute(t, d)
	ctx := tenantCtx(t)

	tx, _ := d.Begin(ctx, store.TxOptions{})
	defer tx.Rollback() //nolint:errcheck

	cfg, err := tx.UpsertRouteOASConfig(ctx, &store.RouteOASConfig{
		RouteID:               routeID,
		TenantID:              "tenant_default",
		OASURL:                "https://example.com/oas.yaml",
		ValidateRequestBody:   true,
		ValidateRequestParams: true,
		RejectUnknown:         false,
	})
	if err != nil {
		t.Fatalf("Upsert: %v", err)
	}
	if cfg.OASURL != "https://example.com/oas.yaml" {
		t.Errorf("OASURL = %q", cfg.OASURL)
	}

	// Round-trip GET.
	got, err := tx.GetRouteOASConfig(ctx, routeID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if !got.ValidateRequestBody {
		t.Error("ValidateRequestBody = false, want true")
	}

	// Update via Upsert preserves PK.
	cfg.OASURL = "https://example.com/v2.yaml"
	cfg.RejectUnknown = true
	if _, err := tx.UpsertRouteOASConfig(ctx, cfg); err != nil {
		t.Fatalf("update Upsert: %v", err)
	}
	got, _ = tx.GetRouteOASConfig(ctx, routeID)
	if got.OASURL != "https://example.com/v2.yaml" || !got.RejectUnknown {
		t.Errorf("update lost: %+v", got)
	}

	// Delete.
	if err := tx.DeleteRouteOASConfig(ctx, routeID); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, err := tx.GetRouteOASConfig(ctx, routeID); !errors.Is(err, store.ErrRouteOASConfigNotFound) {
		t.Fatalf("err after delete = %v, want ErrRouteOASConfigNotFound", err)
	}
}

func TestRouteWAFConfig_UpsertWithDefaults(t *testing.T) {
	d, close := openTempStore(t)
	defer close()
	routeID := createTestRoute(t, d)
	ctx := tenantCtx(t)

	tx, _ := d.Begin(ctx, store.TxOptions{})
	defer tx.Rollback() //nolint:errcheck

	// Pass a partial config; defaults should be applied.
	cfg, err := tx.UpsertRouteWAFConfig(ctx, &store.RouteWAFConfig{
		RouteID:  routeID,
		TenantID: "tenant_default",
		Enabled:  true,
	})
	if err != nil {
		t.Fatalf("Upsert: %v", err)
	}
	if cfg.Mode != store.WAFModeBlock {
		t.Errorf("Mode = %q, want block (default)", cfg.Mode)
	}
	if cfg.RuleSet != "crs" {
		t.Errorf("RuleSet = %q, want crs (default)", cfg.RuleSet)
	}
	if cfg.ParanoiaLevel != 1 {
		t.Errorf("ParanoiaLevel = %d, want 1 (default)", cfg.ParanoiaLevel)
	}
	if cfg.RequestBodyLimit != 131072 {
		t.Errorf("RequestBodyLimit = %d, want 131072 (default)", cfg.RequestBodyLimit)
	}
	if cfg.ExcludedRuleIDs == nil || len(cfg.ExcludedRuleIDs) != 0 {
		t.Errorf("ExcludedRuleIDs = %v, want []", cfg.ExcludedRuleIDs)
	}
}

func TestRouteWAFConfig_ExcludedRulesRoundTrip(t *testing.T) {
	d, close := openTempStore(t)
	defer close()
	routeID := createTestRoute(t, d)
	ctx := tenantCtx(t)

	tx, _ := d.Begin(ctx, store.TxOptions{})
	defer tx.Rollback() //nolint:errcheck

	if _, err := tx.UpsertRouteWAFConfig(ctx, &store.RouteWAFConfig{
		RouteID:         routeID,
		TenantID:        "tenant_default",
		Enabled:         true,
		Mode:            store.WAFModeDetectOnly,
		ParanoiaLevel:   3,
		ExcludedRuleIDs: []string{"941100", "941110", "941160"},
	}); err != nil {
		t.Fatalf("Upsert: %v", err)
	}

	got, _ := tx.GetRouteWAFConfig(ctx, routeID)
	if got.Mode != store.WAFModeDetectOnly {
		t.Errorf("Mode = %q", got.Mode)
	}
	if len(got.ExcludedRuleIDs) != 3 {
		t.Fatalf("ExcludedRuleIDs len = %d, want 3", len(got.ExcludedRuleIDs))
	}
}

func TestWAFDenials_AppendAndQuery(t *testing.T) {
	d, close := openTempStore(t)
	defer close()
	routeID := createTestRoute(t, d)
	ctx := tenantCtx(t)

	tx, _ := d.Begin(ctx, store.TxOptions{})
	defer tx.Rollback() //nolint:errcheck

	for i, rule := range []string{"941100", "941100", "942100"} {
		err := tx.AppendWAFDenial(ctx, &store.WAFDenial{
			ID:         "den_" + uuid.NewString(),
			TenantID:   "tenant_default",
			RouteID:    &routeID,
			RuleID:     rule,
			Severity:   "WARNING",
			Action:     "block",
			RequestURI: "/" + rule,
			ClientIP:   "10.0.0.1",
		})
		if err != nil {
			t.Fatalf("iter %d AppendWAFDenial: %v", i, err)
		}
	}

	all, err := tx.QueryWAFDenials(ctx, store.WAFDenialQuery{})
	if err != nil {
		t.Fatalf("QueryWAFDenials: %v", err)
	}
	if got := len(all); got != 3 {
		t.Errorf("len(all) = %d, want 3", got)
	}

	filtered, err := tx.QueryWAFDenials(ctx, store.WAFDenialQuery{RuleID: "941100"})
	if err != nil {
		t.Fatal(err)
	}
	if got := len(filtered); got != 2 {
		t.Errorf("len(filtered) = %d, want 2", got)
	}

	byRoute, err := tx.QueryWAFDenials(ctx, store.WAFDenialQuery{RouteID: routeID})
	if err != nil {
		t.Fatal(err)
	}
	if got := len(byRoute); got != 3 {
		t.Errorf("len(byRoute) = %d, want 3", got)
	}
}

func TestWAFDenials_DeletedRouteNullsRouteID(t *testing.T) {
	d, close := openTempStore(t)
	defer close()
	routeID := createTestRoute(t, d)
	ctx := tenantCtx(t)

	tx, _ := d.Begin(ctx, store.TxOptions{})
	if err := tx.AppendWAFDenial(ctx, &store.WAFDenial{
		ID: "den_" + uuid.NewString(), TenantID: "tenant_default",
		RouteID: &routeID, RuleID: "941100", Severity: "ERROR",
		Action: "block", RequestURI: "/x", ClientIP: "10.0.0.1",
	}); err != nil {
		t.Fatal(err)
	}
	if err := tx.DeleteRoute(ctx, routeID); err != nil {
		t.Fatal(err)
	}
	_ = tx.Commit()

	tx2, _ := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	defer tx2.Rollback() //nolint:errcheck
	denials, err := tx2.QueryWAFDenials(ctx, store.WAFDenialQuery{})
	if err != nil {
		t.Fatal(err)
	}
	if len(denials) != 1 {
		t.Fatalf("len = %d, want 1", len(denials))
	}
	if denials[0].RouteID != nil {
		t.Errorf("RouteID = %v, want nil after route delete (ON DELETE SET NULL)", denials[0].RouteID)
	}
}
