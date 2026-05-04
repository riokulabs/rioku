package sqlite_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/riokulabs/rioku/internal/store"
	_ "github.com/riokulabs/rioku/internal/store/sqlite"
)

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

func newPlanParams(t *testing.T) store.CreatePlanParams {
	t.Helper()
	return store.CreatePlanParams{
		ID:                 "plan_" + uuid.NewString(),
		TenantID:           "tenant_default",
		APIID:              "api_demo",
		Name:               "Free Plan " + uuid.NewString()[:8],
		Description:        "Basic plan",
		SecurityType:       store.PlanSecurityAPIKey,
		Validation:         store.PlanValidationAuto,
		RateLimitPerMinute: 60,
		QuotaPerDay:        1000,
		SelectionRule:      "",
	}
}

func TestPlan_CreateAndGet(t *testing.T) {
	d, close := openTempStore(t)
	defer close()
	ctx := tenantCtx(t)

	tx, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	defer tx.Rollback() //nolint:errcheck

	p, err := tx.CreatePlan(ctx, newPlanParams(t))
	if err != nil {
		t.Fatalf("CreatePlan: %v", err)
	}
	if p.Status != store.PlanStatusStaging {
		t.Errorf("status = %q, want staging", p.Status)
	}

	got, err := tx.GetPlan(ctx, p.ID)
	if err != nil {
		t.Fatalf("GetPlan: %v", err)
	}
	if got.Name != p.Name || got.SecurityType != p.SecurityType {
		t.Fatalf("round-trip lost fields: %+v", got)
	}
}

func TestPlan_NameUniquePerTenant(t *testing.T) {
	d, close := openTempStore(t)
	defer close()
	ctx := tenantCtx(t)
	tx, _ := d.Begin(ctx, store.TxOptions{})
	defer tx.Rollback() //nolint:errcheck

	first := newPlanParams(t)
	if _, err := tx.CreatePlan(ctx, first); err != nil {
		t.Fatalf("first: %v", err)
	}
	dup := newPlanParams(t)
	dup.Name = first.Name
	if _, err := tx.CreatePlan(ctx, dup); !errors.Is(err, store.ErrPlanNameTaken) {
		t.Fatalf("err = %v, want wrap ErrPlanNameTaken", err)
	}
}

func TestPlan_StateTransitionsAllowedAndRejected(t *testing.T) {
	d, close := openTempStore(t)
	defer close()
	ctx := tenantCtx(t)
	tx, _ := d.Begin(ctx, store.TxOptions{})
	defer tx.Rollback() //nolint:errcheck

	p, err := tx.CreatePlan(ctx, newPlanParams(t))
	if err != nil {
		t.Fatalf("CreatePlan: %v", err)
	}

	// staging → published OK.
	p, err = tx.TransitionPlan(ctx, p.ID, store.PlanStatusPublished)
	if err != nil {
		t.Fatalf("staging→published: %v", err)
	}
	if p.Status != store.PlanStatusPublished {
		t.Fatalf("status = %q", p.Status)
	}

	// published → staging is REJECTED.
	if _, err := tx.TransitionPlan(ctx, p.ID, store.PlanStatusStaging); !errors.Is(err, store.ErrPlanInvalidTransition) {
		t.Fatalf("backwards transition: err = %v", err)
	}

	// published → deprecated OK.
	p, err = tx.TransitionPlan(ctx, p.ID, store.PlanStatusDeprecated)
	if err != nil {
		t.Fatalf("published→deprecated: %v", err)
	}

	// deprecated → archived OK.
	p, err = tx.TransitionPlan(ctx, p.ID, store.PlanStatusArchived)
	if err != nil {
		t.Fatalf("deprecated→archived: %v", err)
	}

	// archived is terminal.
	if _, err := tx.TransitionPlan(ctx, p.ID, store.PlanStatusPublished); !errors.Is(err, store.ErrPlanInvalidTransition) {
		t.Fatalf("from archived: err = %v, want ErrPlanInvalidTransition", err)
	}
}

func TestPlan_UpdatePartial(t *testing.T) {
	d, close := openTempStore(t)
	defer close()
	ctx := tenantCtx(t)
	tx, _ := d.Begin(ctx, store.TxOptions{})
	defer tx.Rollback() //nolint:errcheck

	p, _ := tx.CreatePlan(ctx, newPlanParams(t))
	rate := int32(120)
	updated, err := tx.UpdatePlan(ctx, p.ID, store.UpdatePlanParams{
		RateLimitPerMinute: &rate,
	})
	if err != nil {
		t.Fatalf("UpdatePlan: %v", err)
	}
	if updated.RateLimitPerMinute != 120 {
		t.Fatalf("rate = %d, want 120", updated.RateLimitPerMinute)
	}
	if updated.Name != p.Name {
		t.Fatalf("name was clobbered: %q", updated.Name)
	}
}

func TestPlan_Delete(t *testing.T) {
	d, close := openTempStore(t)
	defer close()
	ctx := tenantCtx(t)
	tx, _ := d.Begin(ctx, store.TxOptions{})
	defer tx.Rollback() //nolint:errcheck

	p, _ := tx.CreatePlan(ctx, newPlanParams(t))
	if err := tx.DeletePlan(ctx, p.ID); err != nil {
		t.Fatalf("DeletePlan: %v", err)
	}
	if _, err := tx.GetPlan(ctx, p.ID); !errors.Is(err, store.ErrPlanNotFound) {
		t.Fatalf("err = %v, want ErrPlanNotFound", err)
	}
}

func TestValidPlanTransition_Matrix(t *testing.T) {
	allowed := map[store.PlanStatus][]store.PlanStatus{
		store.PlanStatusStaging:    {store.PlanStatusPublished, store.PlanStatusArchived},
		store.PlanStatusPublished:  {store.PlanStatusDeprecated, store.PlanStatusArchived},
		store.PlanStatusDeprecated: {store.PlanStatusArchived},
	}
	all := []store.PlanStatus{
		store.PlanStatusStaging, store.PlanStatusPublished,
		store.PlanStatusDeprecated, store.PlanStatusArchived,
	}
	for _, from := range all {
		for _, to := range all {
			want := false
			for _, t2 := range allowed[from] {
				if t2 == to {
					want = true
					break
				}
			}
			if got := store.ValidPlanTransition(from, to); got != want {
				t.Errorf("ValidPlanTransition(%s, %s) = %v, want %v", from, to, got, want)
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

func newAppParams(t *testing.T) store.CreateApplicationParams {
	t.Helper()
	return store.CreateApplicationParams{
		ID:          "app_" + uuid.NewString(),
		TenantID:    "tenant_default",
		Name:        "App " + uuid.NewString()[:8],
		Description: "test app",
	}
}

func TestApplication_CreateAndGet(t *testing.T) {
	d, close := openTempStore(t)
	defer close()
	ctx := tenantCtx(t)
	tx, _ := d.Begin(ctx, store.TxOptions{})
	defer tx.Rollback() //nolint:errcheck

	a, err := tx.CreateApplication(ctx, newAppParams(t))
	if err != nil {
		t.Fatalf("CreateApplication: %v", err)
	}
	if a.Status != store.ApplicationStatusActive {
		t.Errorf("status = %q, want active", a.Status)
	}
}

func TestApplication_StateTransitions(t *testing.T) {
	d, close := openTempStore(t)
	defer close()
	ctx := tenantCtx(t)
	tx, _ := d.Begin(ctx, store.TxOptions{})
	defer tx.Rollback() //nolint:errcheck

	a, _ := tx.CreateApplication(ctx, newAppParams(t))
	a, err := tx.TransitionApplication(ctx, a.ID, store.ApplicationStatusPaused)
	if err != nil {
		t.Fatalf("active→paused: %v", err)
	}
	if a.Status != store.ApplicationStatusPaused {
		t.Fatalf("status = %q", a.Status)
	}
	a, err = tx.TransitionApplication(ctx, a.ID, store.ApplicationStatusActive)
	if err != nil {
		t.Fatalf("paused→active: %v", err)
	}
	a, err = tx.TransitionApplication(ctx, a.ID, store.ApplicationStatusClosed)
	if err != nil {
		t.Fatalf("active→closed: %v", err)
	}
	// closed is terminal.
	if _, err := tx.TransitionApplication(ctx, a.ID, store.ApplicationStatusActive); !errors.Is(err, store.ErrApplicationInvalidTransition) {
		t.Fatalf("closed re-open: err = %v", err)
	}
}

func TestApplication_CloseCascadesToSubscriptions(t *testing.T) {
	d, close := openTempStore(t)
	defer close()
	ctx := tenantCtx(t)
	tx, _ := d.Begin(ctx, store.TxOptions{})
	defer tx.Rollback() //nolint:errcheck

	plan, _ := tx.CreatePlan(ctx, newPlanParams(t))
	app, _ := tx.CreateApplication(ctx, newAppParams(t))
	sub, err := tx.CreateSubscription(ctx, store.CreateSubscriptionParams{
		ID:            "sub_" + uuid.NewString(),
		TenantID:      "tenant_default",
		PlanID:        plan.ID,
		ApplicationID: app.ID,
		APIID:         "api_demo",
	})
	if err != nil {
		t.Fatalf("CreateSubscription: %v", err)
	}
	// Take subscription to accepted so the cascade has something to flip.
	if _, err := tx.TransitionSubscription(ctx, sub.ID, store.SubscriptionStatusAccepted, ""); err != nil {
		t.Fatalf("accept: %v", err)
	}

	if _, err := tx.TransitionApplication(ctx, app.ID, store.ApplicationStatusClosed); err != nil {
		t.Fatalf("close app: %v", err)
	}

	got, err := tx.GetSubscription(ctx, sub.ID)
	if err != nil {
		t.Fatalf("GetSubscription: %v", err)
	}
	if got.Status != store.SubscriptionStatusClosed {
		t.Fatalf("subscription status = %q, want closed (cascade)", got.Status)
	}
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

func TestSubscription_DuplicateLiveRejected(t *testing.T) {
	d, close := openTempStore(t)
	defer close()
	ctx := tenantCtx(t)
	tx, _ := d.Begin(ctx, store.TxOptions{})
	defer tx.Rollback() //nolint:errcheck

	plan, _ := tx.CreatePlan(ctx, newPlanParams(t))
	app, _ := tx.CreateApplication(ctx, newAppParams(t))
	first := store.CreateSubscriptionParams{
		ID:            "sub_" + uuid.NewString(),
		TenantID:      "tenant_default",
		PlanID:        plan.ID,
		ApplicationID: app.ID,
		APIID:         "api_demo",
	}
	if _, err := tx.CreateSubscription(ctx, first); err != nil {
		t.Fatalf("first sub: %v", err)
	}
	dup := first
	dup.ID = "sub_" + uuid.NewString()
	if _, err := tx.CreateSubscription(ctx, dup); !errors.Is(err, store.ErrSubscriptionDuplicate) {
		t.Fatalf("err = %v, want ErrSubscriptionDuplicate", err)
	}
}

func TestSubscription_StateTransitionsAndTerminals(t *testing.T) {
	d, close := openTempStore(t)
	defer close()
	ctx := tenantCtx(t)
	tx, _ := d.Begin(ctx, store.TxOptions{})
	defer tx.Rollback() //nolint:errcheck

	plan, _ := tx.CreatePlan(ctx, newPlanParams(t))
	app, _ := tx.CreateApplication(ctx, newAppParams(t))
	sub, err := tx.CreateSubscription(ctx, store.CreateSubscriptionParams{
		ID:            "sub_" + uuid.NewString(),
		TenantID:      "tenant_default",
		PlanID:        plan.ID,
		ApplicationID: app.ID,
		APIID:         "api_demo",
	})
	if err != nil {
		t.Fatalf("CreateSubscription: %v", err)
	}
	if sub.Status != store.SubscriptionStatusPending {
		t.Fatalf("status = %q, want pending", sub.Status)
	}

	// pending → accepted with reason.
	sub, err = tx.TransitionSubscription(ctx, sub.ID, store.SubscriptionStatusAccepted, "approved by admin")
	if err != nil {
		t.Fatalf("accept: %v", err)
	}
	if sub.ReasonMessage != "approved by admin" {
		t.Errorf("reason = %q", sub.ReasonMessage)
	}

	// accepted → paused (no reason — should preserve previous).
	sub, err = tx.TransitionSubscription(ctx, sub.ID, store.SubscriptionStatusPaused, "")
	if err != nil {
		t.Fatalf("pause: %v", err)
	}
	if sub.ReasonMessage != "approved by admin" {
		t.Errorf("reason clobbered: %q", sub.ReasonMessage)
	}

	// paused → accepted again.
	if _, err := tx.TransitionSubscription(ctx, sub.ID, store.SubscriptionStatusAccepted, ""); err != nil {
		t.Fatalf("resume: %v", err)
	}

	// accepted → closed.
	if _, err := tx.TransitionSubscription(ctx, sub.ID, store.SubscriptionStatusClosed, "operator close"); err != nil {
		t.Fatalf("close: %v", err)
	}

	// closed is terminal.
	if _, err := tx.TransitionSubscription(ctx, sub.ID, store.SubscriptionStatusAccepted, ""); !errors.Is(err, store.ErrSubscriptionInvalidTransition) {
		t.Fatalf("re-open closed: err = %v", err)
	}
}

func TestSubscription_RejectedFromPending(t *testing.T) {
	d, close := openTempStore(t)
	defer close()
	ctx := tenantCtx(t)
	tx, _ := d.Begin(ctx, store.TxOptions{})
	defer tx.Rollback() //nolint:errcheck

	plan, _ := tx.CreatePlan(ctx, newPlanParams(t))
	app, _ := tx.CreateApplication(ctx, newAppParams(t))
	sub, _ := tx.CreateSubscription(ctx, store.CreateSubscriptionParams{
		ID: "sub_" + uuid.NewString(), TenantID: "tenant_default",
		PlanID: plan.ID, ApplicationID: app.ID, APIID: "api_demo",
	})
	sub, err := tx.TransitionSubscription(ctx, sub.ID, store.SubscriptionStatusRejected, "policy violation")
	if err != nil {
		t.Fatalf("reject: %v", err)
	}
	// Rejected is terminal.
	if _, err := tx.TransitionSubscription(ctx, sub.ID, store.SubscriptionStatusAccepted, ""); !errors.Is(err, store.ErrSubscriptionInvalidTransition) {
		t.Fatalf("rejected re-open: err = %v", err)
	}
}

func TestSubscription_ListingByApplicationAndPlan(t *testing.T) {
	d, close := openTempStore(t)
	defer close()
	ctx := tenantCtx(t)
	tx, _ := d.Begin(ctx, store.TxOptions{})
	defer tx.Rollback() //nolint:errcheck

	plan1, _ := tx.CreatePlan(ctx, newPlanParams(t))
	plan2, _ := tx.CreatePlan(ctx, newPlanParams(t))
	app, _ := tx.CreateApplication(ctx, newAppParams(t))

	for _, planID := range []string{plan1.ID, plan2.ID} {
		if _, err := tx.CreateSubscription(ctx, store.CreateSubscriptionParams{
			ID: "sub_" + uuid.NewString(), TenantID: "tenant_default",
			PlanID: planID, ApplicationID: app.ID, APIID: "api_demo",
		}); err != nil {
			t.Fatalf("create: %v", err)
		}
	}

	subs, err := tx.ListSubscriptionsByApplication(ctx, app.ID)
	if err != nil {
		t.Fatalf("list by app: %v", err)
	}
	if len(subs) != 2 {
		t.Fatalf("len(by_app) = %d, want 2", len(subs))
	}
	subs, err = tx.ListSubscriptionsByPlan(ctx, plan1.ID)
	if err != nil {
		t.Fatalf("list by plan: %v", err)
	}
	if len(subs) != 1 {
		t.Fatalf("len(by_plan1) = %d, want 1", len(subs))
	}
}

// ---------------------------------------------------------------------------
// Tenant isolation — ensure cross-tenant reads/writes don't leak
// ---------------------------------------------------------------------------

func TestPlanCrossTenantIsolation(t *testing.T) {
	d, close := openTempStore(t)
	defer close()

	// Both tenants need to exist for the FK; tenant_default is
	// seeded by migration 13. Create tenant_b explicitly.
	ctxA := store.WithTenantID(context.Background(), "tenant_default")
	ctxB := store.WithTenantID(context.Background(), "tenant_b")

	// Bootstrap tenant_b.
	{
		tx, _ := d.Begin(context.Background(), store.TxOptions{})
		if _, err := tx.CreateTenant(context.Background(), &store.Tenant{
			ID:   "tenant_b",
			Slug: "tenant-b-" + strings.ToLower(uuid.NewString()[:8]),
			Name: "Tenant B",
		}); err != nil {
			t.Fatalf("CreateTenant: %v", err)
		}
		_ = tx.Commit()
	}

	// Create plan in tenant_default.
	tx, _ := d.Begin(ctxA, store.TxOptions{})
	defer tx.Rollback() //nolint:errcheck
	plan, _ := tx.CreatePlan(ctxA, newPlanParams(t))

	// Reading from tenant_b should NOT see it.
	if _, err := tx.GetPlan(ctxB, plan.ID); !errors.Is(err, store.ErrPlanNotFound) {
		t.Fatalf("cross-tenant read err = %v, want ErrPlanNotFound", err)
	}
}
