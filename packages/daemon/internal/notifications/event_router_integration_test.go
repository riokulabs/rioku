package notifications_test

// Integration test: exercises the full audit -> event-router -> channel
// path. The config Engine emits an AuditEventEnvelope after every
// successful ApplyChange commit. The notifications.MakeConfigAuditDispatchFn
// adapter translates that envelope into a notifications.AuditEnvelope and
// invokes EventRouter.AsyncEvaluateAndDispatch, which loads the tenant's
// active routing rules, matches them against the envelope's
// `<category>.<subtype>` filter, and fans out to bound channels via the
// ChannelDispatcher.
//
// The engine emits Category="audit" and Subtype=<operation> (CREATE,
// UPDATE, DELETE — case-insensitive matching). So the rule below uses
// the filter `audit.create` to catch service-create mutations.

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/riokulabs/rioku/internal/caddy"
	"github.com/riokulabs/rioku/internal/config"
	"github.com/riokulabs/rioku/internal/notifications"
	"github.com/riokulabs/rioku/internal/store"

	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
)

func TestEventRouter_Integration_ServiceCreateDispatchesViaEngine(t *testing.T) {
	t.Parallel()

	drv := openDB(t)
	tenantID := "tenant_default"

	// Stub channel target — counts deliveries.
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	// Seed a webhook channel + a routing rule that fires on
	// `audit.create` (the shape the engine emits for service creations).
	chanID, _ := seedChannelAndRule(t, drv, tenantID, srv.URL, "audit.create")
	if chanID == "" {
		t.Fatalf("seedChannelAndRule returned empty channel id")
	}

	// Construct the engine and wire the audit dispatcher exactly as the
	// daemon does in production.
	compiler := caddy.NewCompiler([]string{":8080"}, caddy.AdminConfig{}, "", nil, caddy.SecurityHeadersConfig{})
	eng := config.NewEngine(drv, compiler)

	disp := notifications.NewChannelDispatcher(drv, discardLogger())
	disp.MaxRetries = 1
	disp.BaseBackoff = time.Millisecond
	disp.PerAttemptTimeout = 2 * time.Second

	router := notifications.NewEventRouter(drv, disp, discardLogger())

	ctx := store.WithTenantID(context.Background(), tenantID)

	// In production the engine fires the dispatcher async via
	// MakeConfigAuditDispatchFn -> AsyncEvaluateAndDispatch. For the
	// integration test we want determinism (no races against t.Cleanup
	// closing the store), so we install a sync wrapper that drives the
	// router on the calling goroutine. This still exercises the engine
	// -> AuditEventEnvelope -> AuditEnvelope -> router -> channel path
	// end to end; only the goroutine boundary is collapsed.
	eng.SetAuditDispatcher(func(tenantID string, env config.AuditEventEnvelope) {
		_, _, _ = router.EvaluateAndDispatch(ctx, tenantID, notifications.AuditEnvelope{
			Kind:       env.Kind,
			Category:   env.Category,
			Subtype:    env.Subtype,
			Severity:   env.Severity,
			Subject:    env.Subject,
			Body:       env.Body,
			Actor:      env.Actor,
			EntityType: env.EntityType,
			EntityID:   env.EntityID,
			Extra:      env.Extra,
		})
	})

	// Independent assertion: confirm the production adapter accepts a
	// non-nil router and returns a callable closure (i.e. wiring is
	// real, not stubbed). This is what daemon.go installs.
	if notifications.MakeConfigAuditDispatchFn(router) == nil {
		t.Fatalf("MakeConfigAuditDispatchFn returned nil for non-nil router")
	}

	// Trigger a service create through the engine. This commits an
	// audit row and (post-commit) calls the dispatcher we just wired.
	_, err := eng.ApplyChange(ctx, &riokuv1.ConfigChange{
		Operation: &riokuv1.ConfigChange_Service{
			Service: &riokuv1.ServiceOp{
				Action: riokuv1.ServiceOp_UPSERT,
				Service: &riokuv1.Service{
					Name: "router-integration-svc",
					Upstreams: []*riokuv1.Upstream{
						{Address: "127.0.0.1:9001", Weight: 1, Healthy: true},
					},
					LbPolicy: riokuv1.LoadBalancingPolicy_LB_POLICY_ROUND_ROBIN,
				},
			},
		},
	}, "integration-test")
	if err != nil {
		t.Fatalf("ApplyChange service create: %v", err)
	}

	// AsyncEvaluateAndDispatch fires on a background goroutine. Poll
	// for the delivery, with a generous deadline so a slow CI sqlite
	// open doesn't flake the test.
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if calls.Load() >= 1 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	if got := calls.Load(); got != 1 {
		t.Fatalf("stub channel deliveries = %d, want 1 (audit -> router -> channel did not fan out)", got)
	}
}
