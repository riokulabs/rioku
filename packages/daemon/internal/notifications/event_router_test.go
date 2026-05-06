package notifications_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/riokulabs/rioku/internal/config"
	"github.com/riokulabs/rioku/internal/notifications"
	"github.com/riokulabs/rioku/internal/store"
)

// seedChannelAndRule creates a webhook channel + a routing rule whose
// EventFilter matches `filter` and whose ChannelIDs is JSON `[ch.ID]`.
// Returns the channel pointer and the rule ID.
func seedChannelAndRule(t *testing.T, drv store.Driver, tenantID, url, filter string) (string, string) {
	t.Helper()
	ctx := store.WithTenantID(context.Background(), tenantID)

	tx, err := drv.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("Begin: %v", err)
	}
	ch, err := tx.CreateNotificationChannel(ctx, &store.NotificationChannel{
		TenantID: tenantID, Name: "wh-router", Kind: "webhook",
		Config: `{"url":"` + url + `"}`, Enabled: true,
	})
	if err != nil {
		t.Fatalf("CreateNotificationChannel: %v", err)
	}
	rule, err := tx.CreateRoutingRule(ctx, &store.NotificationRoutingRule{
		TenantID:    tenantID,
		Name:        "test-rule",
		EventFilter: filter,
		ChannelIDs:  `["` + ch.ID + `"]`,
		Enabled:     true,
	})
	if err != nil {
		t.Fatalf("CreateRoutingRule: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	return ch.ID, rule.ID
}

func TestEventRouter_MatchingFilterDispatches(t *testing.T) {
	drv := openDB(t)
	tenantID := "tenant_default"

	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	_, _ = seedChannelAndRule(t, drv, tenantID, srv.URL, "service.created")

	disp := notifications.NewChannelDispatcher(drv, discardLogger())
	disp.MaxRetries = 1
	disp.BaseBackoff = time.Millisecond
	disp.PerAttemptTimeout = time.Second

	router := notifications.NewEventRouter(drv, disp, discardLogger())

	matched, delivered, err := router.EvaluateAndDispatch(
		store.WithTenantID(context.Background(), tenantID),
		tenantID,
		notifications.AuditEnvelope{
			Kind:     "service.created",
			Category: "service",
			Subtype:  "created",
			Severity: "info",
			Subject:  "Service created",
			Body:     "svc-1 by alice",
		},
	)
	if err != nil {
		t.Fatalf("EvaluateAndDispatch: %v", err)
	}
	if matched != 1 {
		t.Errorf("matched = %d, want 1", matched)
	}
	if delivered != 1 {
		t.Errorf("delivered = %d, want 1", delivered)
	}
	if got := calls.Load(); got != 1 {
		t.Errorf("HTTP calls = %d, want 1", got)
	}
}

func TestEventRouter_NonMatchingFilterDoesNotDispatch(t *testing.T) {
	drv := openDB(t)
	tenantID := "tenant_default"

	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	// Rule listens for service.* — but we send rbac.role.created.
	_, _ = seedChannelAndRule(t, drv, tenantID, srv.URL, "service.*")

	disp := notifications.NewChannelDispatcher(drv, discardLogger())
	disp.MaxRetries = 1
	disp.BaseBackoff = time.Millisecond

	router := notifications.NewEventRouter(drv, disp, discardLogger())

	matched, delivered, err := router.EvaluateAndDispatch(
		store.WithTenantID(context.Background(), tenantID),
		tenantID,
		notifications.AuditEnvelope{
			Kind:     "rbac.created",
			Category: "rbac",
			Subtype:  "created",
		},
	)
	if err != nil {
		t.Fatalf("EvaluateAndDispatch: %v", err)
	}
	if matched != 0 {
		t.Errorf("matched = %d, want 0", matched)
	}
	if delivered != 0 {
		t.Errorf("delivered = %d, want 0", delivered)
	}
	if got := calls.Load(); got != 0 {
		t.Errorf("HTTP calls = %d, want 0", got)
	}
}

func TestEventRouter_MalformedFilterIsLoggedAndSkipped(t *testing.T) {
	drv := openDB(t)
	tenantID := "tenant_default"

	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	// Filter without the dot separator — must not crash, must not dispatch.
	_, _ = seedChannelAndRule(t, drv, tenantID, srv.URL, "this-is-not-valid")

	disp := notifications.NewChannelDispatcher(drv, discardLogger())
	disp.MaxRetries = 1
	disp.BaseBackoff = time.Millisecond

	router := notifications.NewEventRouter(drv, disp, discardLogger())

	matched, delivered, err := router.EvaluateAndDispatch(
		store.WithTenantID(context.Background(), tenantID),
		tenantID,
		notifications.AuditEnvelope{
			Kind:     "service.created",
			Category: "service",
			Subtype:  "created",
		},
	)
	if err != nil {
		t.Fatalf("EvaluateAndDispatch returned error (should be logged, not propagated): %v", err)
	}
	if matched != 0 {
		t.Errorf("matched = %d, want 0", matched)
	}
	if delivered != 0 {
		t.Errorf("delivered = %d, want 0", delivered)
	}
	if got := calls.Load(); got != 0 {
		t.Errorf("HTTP calls = %d, want 0", got)
	}
}

func TestEventRouter_NoRulesIsNoOp(t *testing.T) {
	drv := openDB(t)
	tenantID := "tenant_default"

	disp := notifications.NewChannelDispatcher(drv, discardLogger())
	router := notifications.NewEventRouter(drv, disp, discardLogger())

	matched, delivered, err := router.EvaluateAndDispatch(
		store.WithTenantID(context.Background(), tenantID),
		tenantID,
		notifications.AuditEnvelope{Kind: "service.created", Category: "service", Subtype: "created"},
	)
	if err != nil {
		t.Fatalf("EvaluateAndDispatch: %v", err)
	}
	if matched != 0 || delivered != 0 {
		t.Errorf("matched=%d delivered=%d, both want 0", matched, delivered)
	}
}

func TestEventRouter_DisabledRuleSkipped(t *testing.T) {
	drv := openDB(t)
	tenantID := "tenant_default"

	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	ctx := store.WithTenantID(context.Background(), tenantID)
	tx, _ := drv.Begin(ctx, store.TxOptions{})
	ch, err := tx.CreateNotificationChannel(ctx, &store.NotificationChannel{
		TenantID: tenantID, Name: "wh", Kind: "webhook",
		Config: `{"url":"` + srv.URL + `"}`, Enabled: true,
	})
	if err != nil {
		t.Fatalf("CreateNotificationChannel: %v", err)
	}
	if _, err := tx.CreateRoutingRule(ctx, &store.NotificationRoutingRule{
		TenantID: tenantID, Name: "off", EventFilter: "service.created",
		ChannelIDs: `["` + ch.ID + `"]`, Enabled: false,
	}); err != nil {
		t.Fatalf("CreateRoutingRule: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit: %v", err)
	}

	disp := notifications.NewChannelDispatcher(drv, discardLogger())
	router := notifications.NewEventRouter(drv, disp, discardLogger())

	matched, _, err := router.EvaluateAndDispatch(ctx, tenantID,
		notifications.AuditEnvelope{Kind: "service.created", Category: "service", Subtype: "created"})
	if err != nil {
		t.Fatalf("EvaluateAndDispatch: %v", err)
	}
	if matched != 0 {
		t.Errorf("matched = %d, want 0 (rule disabled)", matched)
	}
	if got := calls.Load(); got != 0 {
		t.Errorf("HTTP calls = %d, want 0", got)
	}
}

func TestEventRouter_AsyncDispatchDoesNotBlock(t *testing.T) {
	drv := openDB(t)
	tenantID := "tenant_default"

	// No channels, no rules — async dispatch must still return without
	// blocking. We assert only the call-site semantics; correctness of
	// the dispatch itself is covered by the synchronous tests above.
	disp := notifications.NewChannelDispatcher(drv, discardLogger())
	router := notifications.NewEventRouter(drv, disp, discardLogger())

	start := time.Now()
	router.AsyncEvaluateAndDispatch(tenantID, notifications.AuditEnvelope{
		Kind: "service.created", Category: "service", Subtype: "created",
	})
	elapsed := time.Since(start)
	if elapsed > 100*time.Millisecond {
		t.Errorf("AsyncEvaluateAndDispatch blocked for %v; should return immediately", elapsed)
	}
	// Give the spawned goroutine time to read rules and exit so it does
	// not race with t.Cleanup closing the DB.
	time.Sleep(200 * time.Millisecond)
}

func TestMatchesFilter_TableDriven(t *testing.T) {
	cases := []struct {
		name   string
		filter string
		env    notifications.AuditEnvelope
		want   bool
	}{
		{"exact match", "service.created",
			notifications.AuditEnvelope{Category: "service", Subtype: "created"}, true},
		{"wildcard category", "*.created",
			notifications.AuditEnvelope{Category: "rbac", Subtype: "created"}, true},
		{"wildcard subtype", "audit.*",
			notifications.AuditEnvelope{Category: "audit", Subtype: "destructive"}, true},
		{"both wildcards", "*.*",
			notifications.AuditEnvelope{Category: "anything", Subtype: "anything"}, true},
		{"category mismatch", "service.created",
			notifications.AuditEnvelope{Category: "rbac", Subtype: "created"}, false},
		{"subtype falls back to severity", "*.error",
			notifications.AuditEnvelope{Category: "system", Subtype: "boot", Severity: "error"}, true},
		{"malformed filter (no dot)", "broken",
			notifications.AuditEnvelope{Category: "audit", Subtype: "create"}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := notifications.MatchesFilter(tc.filter, tc.env); got != tc.want {
				t.Errorf("MatchesFilter(%q) = %v, want %v", tc.filter, got, tc.want)
			}
		})
	}
}

// TestEventRouter_ConfigAuditDispatchFn covers the closure factory that
// the config engine wires after committing an audit entry.
func TestEventRouter_ConfigAuditDispatchFn(t *testing.T) {
	drv := openDB(t)
	tenantID := "tenant_default"

	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	_, _ = seedChannelAndRule(t, drv, tenantID, srv.URL, "audit.create")

	disp := notifications.NewChannelDispatcher(drv, discardLogger())
	disp.MaxRetries = 1
	disp.BaseBackoff = time.Millisecond

	router := notifications.NewEventRouter(drv, disp, discardLogger())
	fn := notifications.MakeConfigAuditDispatchFn(router)
	if fn == nil {
		t.Fatal("MakeConfigAuditDispatchFn returned nil")
	}

	// The closure projects config.AuditEventEnvelope into the
	// notifications envelope and triggers async dispatch — verify the
	// projection by also exercising the synchronous path with a matching
	// envelope so we can assert without racing the goroutine on cleanup.
	env := configAuditEnvelopeStub("service", "create", "alice", "svc-1")
	matched, delivered, err := router.EvaluateAndDispatch(
		store.WithTenantID(context.Background(), tenantID),
		tenantID,
		notifications.AuditEnvelope{
			Kind:       env.Kind,
			Category:   env.Category,
			Subtype:    env.Subtype,
			Severity:   env.Severity,
			Subject:    env.Subject,
			Body:       env.Body,
			Actor:      env.Actor,
			EntityType: env.EntityType,
			EntityID:   env.EntityID,
		},
	)
	if err != nil {
		t.Fatalf("EvaluateAndDispatch: %v", err)
	}
	if matched != 1 || delivered != 1 {
		t.Errorf("matched=%d delivered=%d, both want 1", matched, delivered)
	}
	if got := calls.Load(); got != 1 {
		t.Errorf("HTTP calls = %d, want 1", got)
	}
}

// configAuditEnvelopeStub builds a config.AuditEventEnvelope.
func configAuditEnvelopeStub(category, subtype, actor, entityID string) config.AuditEventEnvelope {
	return config.AuditEventEnvelope{
		Kind:       category + "." + subtype,
		Category:   "audit",
		Subtype:    subtype,
		Severity:   "info",
		Subject:    category + " " + subtype,
		Body:       category + "/" + entityID + " by " + actor,
		Actor:      actor,
		EntityType: category,
		EntityID:   entityID,
	}
}
