package grpc

import (
	"context"
	"path/filepath"
	"sync"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/riokulabs/rioku/internal/store"
	_ "github.com/riokulabs/rioku/internal/store/sqlite"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
)

// fakeWebhookEmitter records every emit call so tests can assert
// on the events the service fires for state transitions.
type fakeWebhookEmitter struct {
	mu     sync.Mutex
	events []WebhookEvent
}

func (f *fakeWebhookEmitter) Emit(_ context.Context, ev WebhookEvent) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.events = append(f.events, ev)
}

func (f *fakeWebhookEmitter) types() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]string, len(f.events))
	for i, e := range f.events {
		out[i] = e.Type
	}
	return out
}

func setupAPIManagementTest(t *testing.T) (riokuv1.APIManagementServiceServer, *fakeWebhookEmitter, context.Context) {
	t.Helper()
	ctx := context.Background()
	d, err := store.New("sqlite")
	if err != nil {
		t.Fatal(err)
	}
	dbPath := filepath.Join(t.TempDir(), "test.db")
	if err := d.Open(ctx, store.DriverConfig{Path: dbPath}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })
	if err := d.Migrate(ctx, store.MigrateUp); err != nil {
		t.Fatal(err)
	}

	hooks := &fakeWebhookEmitter{}
	svc := newAPIManagementService(d, hooks)
	tenantCtx := store.WithTenantID(ctx, "tenant_default")
	return svc, hooks, tenantCtx
}

func TestAPIManagement_PlanCRUD(t *testing.T) {
	svc, hooks, ctx := setupAPIManagementTest(t)

	plan, err := svc.CreatePlan(ctx, &riokuv1.CreatePlanRequest{
		ApiId:              "api_demo",
		Name:               "Free",
		Description:        "no-cost",
		SecurityType:       "api_key",
		Validation:         "auto",
		RateLimitPerMinute: 60,
	})
	if err != nil {
		t.Fatalf("CreatePlan: %v", err)
	}
	if plan.GetId() == "" {
		t.Fatal("Id was not auto-generated")
	}
	if plan.GetStatus() != "staging" {
		t.Errorf("status = %q, want staging", plan.GetStatus())
	}

	got, err := svc.GetPlan(ctx, &riokuv1.GetPlanRequest{Id: plan.GetId()})
	if err != nil {
		t.Fatalf("GetPlan: %v", err)
	}
	if got.GetName() != "Free" {
		t.Errorf("name = %q", got.GetName())
	}

	// Webhook fired on create.
	if events := hooks.types(); len(events) == 0 || events[0] != "plan.created" {
		t.Errorf("expected plan.created webhook, got %v", events)
	}
}

func TestAPIManagement_PlanTransitionFiresWebhookAndRejectsBackwards(t *testing.T) {
	svc, hooks, ctx := setupAPIManagementTest(t)

	plan, err := svc.CreatePlan(ctx, &riokuv1.CreatePlanRequest{
		ApiId: "api_demo", Name: "Pro", SecurityType: "api_key", Validation: "auto",
	})
	if err != nil {
		t.Fatal(err)
	}

	// staging → published
	pub, err := svc.TransitionPlan(ctx, &riokuv1.TransitionPlanRequest{
		Id:     plan.GetId(),
		Status: "published",
	})
	if err != nil {
		t.Fatalf("transition: %v", err)
	}
	if pub.GetStatus() != "published" {
		t.Errorf("status = %q", pub.GetStatus())
	}

	// published → staging is REJECTED with FailedPrecondition.
	_, err = svc.TransitionPlan(ctx, &riokuv1.TransitionPlanRequest{
		Id:     plan.GetId(),
		Status: "staging",
	})
	if err == nil {
		t.Fatal("expected backwards transition to fail")
	}
	if got := status.Code(err); got != codes.FailedPrecondition {
		t.Errorf("code = %v, want FailedPrecondition", got)
	}

	// Webhook events should include plan.created + plan.published.
	events := hooks.types()
	want := map[string]bool{"plan.created": true, "plan.published": true}
	for _, e := range events {
		delete(want, e)
	}
	if len(want) != 0 {
		t.Errorf("missing webhook events: %v (got %v)", want, hooks.types())
	}
}

func TestAPIManagement_DuplicatePlanNameReturnsAlreadyExists(t *testing.T) {
	svc, _, ctx := setupAPIManagementTest(t)

	_, err := svc.CreatePlan(ctx, &riokuv1.CreatePlanRequest{
		ApiId: "api_demo", Name: "Same", SecurityType: "api_key", Validation: "auto",
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = svc.CreatePlan(ctx, &riokuv1.CreatePlanRequest{
		ApiId: "api_demo", Name: "Same", SecurityType: "api_key", Validation: "auto",
	})
	if err == nil {
		t.Fatal("expected duplicate-name error")
	}
	if got := status.Code(err); got != codes.AlreadyExists {
		t.Errorf("code = %v, want AlreadyExists", got)
	}
}

func TestAPIManagement_AutoValidationFlipsToAccepted(t *testing.T) {
	svc, hooks, ctx := setupAPIManagementTest(t)

	plan, _ := svc.CreatePlan(ctx, &riokuv1.CreatePlanRequest{
		ApiId: "api_demo", Name: "Auto", SecurityType: "api_key", Validation: "auto",
	})
	app, _ := svc.CreateApplication(ctx, &riokuv1.CreateApplicationRequest{
		Name: "Customer A",
	})

	sub, err := svc.CreateSubscription(ctx, &riokuv1.CreateSubscriptionRequest{
		PlanId:        plan.GetId(),
		ApplicationId: app.GetId(),
		ApiId:         "api_demo",
	})
	if err != nil {
		t.Fatalf("CreateSubscription: %v", err)
	}
	// Validation=auto should flip the new sub to accepted in the
	// same tx.
	if sub.GetStatus() != "accepted" {
		t.Errorf("status = %q, want accepted (validation=auto)", sub.GetStatus())
	}
	// subscription.created + subscription.accepted webhooks should
	// both have fired.
	events := hooks.types()
	saw := map[string]int{}
	for _, e := range events {
		saw[e]++
	}
	if saw["subscription.created"] == 0 {
		t.Errorf("missing subscription.created in %v", events)
	}
	if saw["subscription.accepted"] == 0 {
		t.Errorf("missing subscription.accepted in %v", events)
	}
}

func TestAPIManagement_ManualValidationStaysPending(t *testing.T) {
	svc, _, ctx := setupAPIManagementTest(t)

	plan, _ := svc.CreatePlan(ctx, &riokuv1.CreatePlanRequest{
		ApiId: "api_demo", Name: "Manual", SecurityType: "api_key", Validation: "manual",
	})
	app, _ := svc.CreateApplication(ctx, &riokuv1.CreateApplicationRequest{
		Name: "Customer B",
	})

	sub, err := svc.CreateSubscription(ctx, &riokuv1.CreateSubscriptionRequest{
		PlanId:        plan.GetId(),
		ApplicationId: app.GetId(),
		ApiId:         "api_demo",
	})
	if err != nil {
		t.Fatal(err)
	}
	if sub.GetStatus() != "pending" {
		t.Errorf("status = %q, want pending (validation=manual)", sub.GetStatus())
	}

	// Approver accepts.
	accepted, err := svc.TransitionSubscription(ctx, &riokuv1.TransitionSubscriptionRequest{
		Id:     sub.GetId(),
		Status: "accepted",
		Reason: "approved by integration",
	})
	if err != nil {
		t.Fatalf("transition: %v", err)
	}
	if accepted.GetReasonMessage() != "approved by integration" {
		t.Errorf("reason = %q", accepted.GetReasonMessage())
	}
}

func TestAPIManagement_GetPlanNotFoundReturnsNotFound(t *testing.T) {
	svc, _, ctx := setupAPIManagementTest(t)
	_, err := svc.GetPlan(ctx, &riokuv1.GetPlanRequest{Id: "missing"})
	if err == nil {
		t.Fatal("expected not-found error")
	}
	if got := status.Code(err); got != codes.NotFound {
		t.Errorf("code = %v, want NotFound", got)
	}
}

func TestAPIManagement_ListPlansFilteredByAPI(t *testing.T) {
	svc, _, ctx := setupAPIManagementTest(t)

	for _, api := range []string{"api_a", "api_a", "api_b"} {
		if _, err := svc.CreatePlan(ctx, &riokuv1.CreatePlanRequest{
			ApiId: api, Name: api + "-plan-" + filepath.Base(t.TempDir()), SecurityType: "api_key", Validation: "auto",
		}); err != nil {
			t.Fatal(err)
		}
	}

	a, err := svc.ListPlans(ctx, &riokuv1.ListPlansRequest{ApiId: "api_a"})
	if err != nil {
		t.Fatal(err)
	}
	if got := len(a.GetPlans()); got != 2 {
		t.Errorf("api_a count = %d, want 2", got)
	}

	b, err := svc.ListPlans(ctx, &riokuv1.ListPlansRequest{ApiId: "api_b"})
	if err != nil {
		t.Fatal(err)
	}
	if got := len(b.GetPlans()); got != 1 {
		t.Errorf("api_b count = %d, want 1", got)
	}
}
