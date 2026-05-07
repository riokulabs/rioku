package gateway

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/riokulabs/rioku/internal/store"
)

func TestAIProviders_CRUD(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterAIRoutes(mux, drv)

	// Create
	req := authedTenantRequest(t, drv, http.MethodPost, "/api/v1/t/default/ai/providers", "default",
		map[string]any{"name": "openai-prod", "kind": "openai", "baseUrl": "https://api.openai.com"})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: %d (%s)", rec.Code, rec.Body.String())
	}
	var created aiProviderResponse
	_ = json.NewDecoder(rec.Body).Decode(&created)

	// Add a model
	addReq := authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/ai/providers/"+created.ID+"/models", "default",
		map[string]any{"upstreamModelId": "gpt-4-turbo", "alias": "gpt4"})
	addRec := httptest.NewRecorder()
	mux.ServeHTTP(addRec, addReq)
	if addRec.Code != http.StatusCreated {
		t.Fatalf("add model: %d (%s)", addRec.Code, addRec.Body.String())
	}
	var model providerModelResponse
	_ = json.NewDecoder(addRec.Body).Decode(&model)
	if model.Alias != "gpt4" {
		t.Errorf("alias = %q", model.Alias)
	}

	// Test endpoint stub
	testReq := authedTenantRequest(t, drv, http.MethodPost,
		"/api/v1/t/default/ai/providers/"+created.ID+"/test", "default", nil)
	testRec := httptest.NewRecorder()
	mux.ServeHTTP(testRec, testReq)
	if testRec.Code != http.StatusOK {
		t.Errorf("test: %d", testRec.Code)
	}

	// Delete
	delReq := authedTenantRequest(t, drv, http.MethodDelete,
		"/api/v1/t/default/ai/providers/"+created.ID, "default", nil)
	delRec := httptest.NewRecorder()
	mux.ServeHTTP(delRec, delReq)
	if delRec.Code != http.StatusNoContent {
		t.Errorf("delete: %d", delRec.Code)
	}
}

func TestAIAgents_BindingsLifecycle(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterAIRoutes(mux, drv)

	// Create provider, agent, tool.
	mux.ServeHTTP(httptest.NewRecorder(), authedTenantRequest(t, drv,
		http.MethodPost, "/api/v1/t/default/ai/providers", "default",
		map[string]any{"name": "p1", "kind": "openai"}))

	agentRec := httptest.NewRecorder()
	mux.ServeHTTP(agentRec, authedTenantRequest(t, drv,
		http.MethodPost, "/api/v1/t/default/ai/agents", "default",
		map[string]any{"name": "agent1"}))
	var agent aiAgentResponse
	_ = json.NewDecoder(agentRec.Body).Decode(&agent)

	toolRec := httptest.NewRecorder()
	mux.ServeHTTP(toolRec, authedTenantRequest(t, drv,
		http.MethodPost, "/api/v1/t/default/ai/tools", "default",
		map[string]any{"name": "tool1", "kind": "native"}))
	var tool aiToolResponse
	_ = json.NewDecoder(toolRec.Body).Decode(&tool)

	// Bind
	bindRec := httptest.NewRecorder()
	mux.ServeHTTP(bindRec, authedTenantRequest(t, drv,
		http.MethodPost, "/api/v1/t/default/ai/tool-bindings", "default",
		map[string]any{"agentId": agent.ID, "toolId": tool.ID}))
	if bindRec.Code != http.StatusCreated {
		t.Fatalf("bind: %d (%s)", bindRec.Code, bindRec.Body.String())
	}
	var binding aiToolBindingResponse
	_ = json.NewDecoder(bindRec.Body).Decode(&binding)

	// Duplicate bind fails 409.
	dupRec := httptest.NewRecorder()
	mux.ServeHTTP(dupRec, authedTenantRequest(t, drv,
		http.MethodPost, "/api/v1/t/default/ai/tool-bindings", "default",
		map[string]any{"agentId": agent.ID, "toolId": tool.ID}))
	if dupRec.Code != http.StatusConflict {
		t.Errorf("dup bind: expected 409, got %d", dupRec.Code)
	}

	// List by agent
	listRec := httptest.NewRecorder()
	mux.ServeHTTP(listRec, authedTenantRequest(t, drv,
		http.MethodGet, "/api/v1/t/default/ai/agents/"+agent.ID+"/tools", "default", nil))
	if listRec.Code != http.StatusOK {
		t.Errorf("list bindings by agent: %d", listRec.Code)
	}

	// Delete binding
	delRec := httptest.NewRecorder()
	mux.ServeHTTP(delRec, authedTenantRequest(t, drv,
		http.MethodDelete, "/api/v1/t/default/ai/tool-bindings/"+binding.ID, "default", nil))
	if delRec.Code != http.StatusNoContent {
		t.Errorf("delete binding: %d", delRec.Code)
	}
}

func TestAITools_CRUDAndConflict(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterAIRoutes(mux, drv)

	body := map[string]any{"name": "calc", "kind": "native", "description": "math"}
	r := httptest.NewRecorder()
	mux.ServeHTTP(r, authedTenantRequest(t, drv,
		http.MethodPost, "/api/v1/t/default/ai/tools", "default", body))
	if r.Code != http.StatusCreated {
		t.Fatalf("create: %d", r.Code)
	}

	// Duplicate name → 409.
	r2 := httptest.NewRecorder()
	mux.ServeHTTP(r2, authedTenantRequest(t, drv,
		http.MethodPost, "/api/v1/t/default/ai/tools", "default", body))
	if r2.Code != http.StatusConflict {
		t.Errorf("dup: expected 409, got %d", r2.Code)
	}
}

func TestAIRateLimits_CRUD(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterAIRoutes(mux, drv)

	body := map[string]any{
		"name":   "rl1",
		"scope":  "tenant",
		"action": "block",
	}
	r := httptest.NewRecorder()
	mux.ServeHTTP(r, authedTenantRequest(t, drv,
		http.MethodPost, "/api/v1/t/default/ai/rate-limits", "default", body))
	if r.Code != http.StatusCreated {
		t.Fatalf("create: %d (%s)", r.Code, r.Body.String())
	}
}

// TestAIRateLimits_SimulateAndMetrics covers the stage-2 "Simulate" and
// "Metrics" tabs the admin panel renders for an individual rate-limit.
// Both endpoints live under RegisterAIExtraRoutes; we register CRUD +
// extras together so the simulator can read the rule we just created.
func TestAIRateLimits_SimulateAndMetrics(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterAIRoutes(mux, drv)
	RegisterAIExtraRoutes(mux, drv)

	// Create the rule with a small threshold/window so we can exercise both
	// would_throttle=true and would_throttle=false branches deterministically.
	createRec := httptest.NewRecorder()
	mux.ServeHTTP(createRec, authedTenantRequest(t, drv,
		http.MethodPost, "/api/v1/t/default/ai/rate-limits", "default",
		map[string]any{
			"name":          "probe-rule",
			"scope":         "tenant",
			"action":        "block",
			"threshold":     10,
			"windowSeconds": 60,
		}))
	if createRec.Code != http.StatusCreated {
		t.Fatalf("create: %d (%s)", createRec.Code, createRec.Body.String())
	}
	var created aiRateLimitResponse
	if err := json.NewDecoder(createRec.Body).Decode(&created); err != nil {
		t.Fatalf("decode created: %v", err)
	}

	type simulateResp struct {
		RateLimitID        string `json:"rate_limit_id"`
		Principal          string `json:"principal"`
		WouldThrottle      bool   `json:"would_throttle"`
		RetryAfterMs       int    `json:"retry_after_ms"`
		CurrentConsumption int    `json:"current_consumption"`
		Limit              int    `json:"limit"`
	}

	cases := []struct {
		name             string
		body             map[string]any
		wantThrottle     bool
		wantConsumption  int
		wantRetryAfterGt int
	}{
		{
			name: "under limit — would_throttle=false",
			body: map[string]any{
				"request_count":       3,
				"time_window_seconds": 60,
				"principal":           "user-1",
			},
			wantThrottle:     false,
			wantConsumption:  3,
			wantRetryAfterGt: -1, // == 0
		},
		{
			name: "over limit — would_throttle=true",
			body: map[string]any{
				"request_count":       50,
				"time_window_seconds": 60,
				"principal":           "user-2",
			},
			wantThrottle:     true,
			wantConsumption:  50,
			wantRetryAfterGt: 0,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, authedTenantRequest(t, drv,
				http.MethodPost,
				"/api/v1/t/default/ai/rate-limits/"+created.ID+"/simulate",
				"default", tc.body))
			if rec.Code != http.StatusOK {
				t.Fatalf("simulate: %d (%s)", rec.Code, rec.Body.String())
			}
			var got simulateResp
			if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
				t.Fatalf("decode: %v", err)
			}
			if got.RateLimitID != created.ID {
				t.Errorf("rate_limit_id = %q, want %q", got.RateLimitID, created.ID)
			}
			if got.WouldThrottle != tc.wantThrottle {
				t.Errorf("would_throttle = %v, want %v (resp=%+v)", got.WouldThrottle, tc.wantThrottle, got)
			}
			if got.CurrentConsumption != tc.wantConsumption {
				t.Errorf("current_consumption = %d, want %d", got.CurrentConsumption, tc.wantConsumption)
			}
			if got.Limit != 10 {
				t.Errorf("limit = %d, want 10", got.Limit)
			}
			if tc.wantRetryAfterGt >= 0 && got.RetryAfterMs <= tc.wantRetryAfterGt {
				t.Errorf("retry_after_ms = %d, want > %d", got.RetryAfterMs, tc.wantRetryAfterGt)
			}
			if !tc.wantThrottle && got.RetryAfterMs != 0 {
				t.Errorf("retry_after_ms = %d, want 0 when not throttled", got.RetryAfterMs)
			}
			if got.Principal != tc.body["principal"] {
				t.Errorf("principal echo = %q, want %q", got.Principal, tc.body["principal"])
			}
		})
	}

	// Metrics — must respect ?since= and return a stable point series shaped
	// for the panel's chart.
	for _, since := range []string{"24h", "1h", "7d"} {
		mRec := httptest.NewRecorder()
		mux.ServeHTTP(mRec, authedTenantRequest(t, drv,
			http.MethodGet,
			"/api/v1/t/default/ai/rate-limits/"+created.ID+"/metrics?since="+since,
			"default", nil))
		if mRec.Code != http.StatusOK {
			t.Fatalf("metrics %s: %d (%s)", since, mRec.Code, mRec.Body.String())
		}
		var got struct {
			RateLimitID string           `json:"rate_limit_id"`
			Since       string           `json:"since"`
			Points      []map[string]any `json:"points"`
		}
		if err := json.NewDecoder(mRec.Body).Decode(&got); err != nil {
			t.Fatalf("metrics decode: %v", err)
		}
		if got.RateLimitID != created.ID {
			t.Errorf("metrics: rate_limit_id = %q, want %q", got.RateLimitID, created.ID)
		}
		if got.Since != since {
			t.Errorf("metrics: since = %q, want %q", got.Since, since)
		}
		wantPoints := map[string]int{"24h": 24, "1h": 60, "7d": 7}[since]
		if len(got.Points) != wantPoints {
			t.Errorf("metrics %s: %d points, want %d", since, len(got.Points), wantPoints)
		}
		for i, p := range got.Points {
			if _, ok := p["timestamp"].(string); !ok {
				t.Errorf("metrics %s: point[%d].timestamp not a string: %v", since, i, p)
			}
			if _, ok := p["throttle_events"]; !ok {
				t.Errorf("metrics %s: point[%d] missing throttle_events: %v", since, i, p)
			}
		}
	}

	// Default since (omitted) is 24h.
	dRec := httptest.NewRecorder()
	mux.ServeHTTP(dRec, authedTenantRequest(t, drv,
		http.MethodGet,
		"/api/v1/t/default/ai/rate-limits/"+created.ID+"/metrics",
		"default", nil))
	if dRec.Code != http.StatusOK {
		t.Fatalf("metrics default: %d", dRec.Code)
	}
	var def struct {
		Since  string           `json:"since"`
		Points []map[string]any `json:"points"`
	}
	_ = json.NewDecoder(dRec.Body).Decode(&def)
	if def.Since != "24h" || len(def.Points) != 24 {
		t.Errorf("default metrics: since=%q, points=%d", def.Since, len(def.Points))
	}
}

func TestAITraces_AppendAndRead(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterAIRoutes(mux, drv)

	// Append a trace via the store directly (no public REST POST yet).
	ctx := context.Background()
	tx, _ := drv.Begin(ctx, store.TxOptions{})
	tr, err := tx.AppendAITrace(ctx, &store.AITrace{
		TenantID: "tenant_default", Status: "success", Model: "gpt-4",
		InputTokens: 10, OutputTokens: 20, DurationMS: 250,
		OccurredAt: time.Now().UTC(),
	})
	if err != nil {
		t.Fatalf("AppendAITrace: %v", err)
	}
	_ = tx.Commit()

	// List
	listRec := httptest.NewRecorder()
	mux.ServeHTTP(listRec, authedTenantRequest(t, drv,
		http.MethodGet, "/api/v1/t/default/ai/traces", "default", nil))
	if listRec.Code != http.StatusOK {
		t.Fatalf("list: %d", listRec.Code)
	}
	var list map[string]any
	_ = json.NewDecoder(listRec.Body).Decode(&list)
	if list["total"].(float64) < 1 {
		t.Errorf("expected ≥1 trace, got %v", list["total"])
	}

	// Get by id
	getRec := httptest.NewRecorder()
	mux.ServeHTTP(getRec, authedTenantRequest(t, drv,
		http.MethodGet, "/api/v1/t/default/ai/traces/"+tr.ID, "default", nil))
	if getRec.Code != http.StatusOK {
		t.Errorf("get trace: %d", getRec.Code)
	}
}

// TestAITraces_GetRedactedByDefault asserts that GET-by-id NEVER returns
// the prompt or completion fields — they're only surfaced via the reveal
// endpoint after an audit row is appended. Spec §7 RD5.
func TestAITraces_GetRedactedByDefault(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterAIRoutes(mux, drv)

	ctx := context.Background()
	tx, _ := drv.Begin(ctx, store.TxOptions{})
	prompt := "secret prompt PII"
	completion := "secret completion PII"
	tr, err := tx.AppendAITrace(ctx, &store.AITrace{
		TenantID: "tenant_default", Status: "success", Model: "gpt-4",
		InputTokens: 1, OutputTokens: 1, DurationMS: 1,
		Prompt: &prompt, Completion: &completion,
		OccurredAt: time.Now().UTC(),
	})
	if err != nil {
		t.Fatalf("AppendAITrace: %v", err)
	}
	_ = tx.Commit()

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, authedTenantRequest(t, drv,
		http.MethodGet, "/api/v1/t/default/ai/traces/"+tr.ID, "default", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("get trace: %d", rec.Code)
	}
	var got aiTraceResponse
	_ = json.NewDecoder(rec.Body).Decode(&got)
	if got.Prompt != nil || got.Completion != nil {
		t.Errorf("expected redacted prompt/completion on GET, got prompt=%v completion=%v", got.Prompt, got.Completion)
	}
}

// TestAITraces_RevealRequiresReason: a body with no/short reason → 400.
func TestAITraces_RevealRequiresReason(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterAIRoutes(mux, drv)

	ctx := context.Background()
	tx, _ := drv.Begin(ctx, store.TxOptions{})
	prompt := "p"
	tr, err := tx.AppendAITrace(ctx, &store.AITrace{
		TenantID: "tenant_default", Status: "success", Model: "gpt-4",
		InputTokens: 1, OutputTokens: 1, DurationMS: 1,
		Prompt: &prompt, OccurredAt: time.Now().UTC(),
	})
	if err != nil {
		t.Fatalf("AppendAITrace: %v", err)
	}
	_ = tx.Commit()

	for _, badReason := range []string{"", "ok", "         ", "too short"} {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, authedTenantRequest(t, drv,
			http.MethodPost, "/api/v1/t/default/ai/traces/"+tr.ID+"/reveal", "default",
			map[string]any{"reason": badReason}))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("reason=%q: expected 400, got %d (%s)", badReason, rec.Code, rec.Body.String())
		}
	}
}

// TestAITraces_RevealUnmasksAndAuditsAndIsTransactional asserts the
// happy path: with a sufficient reason the unmasked payload is
// returned AND an audit row of schema ai.trace_sensitive_revealed.v1
// lands in the same tx (committed atomically).
func TestAITraces_RevealUnmasksAndAuditsAndIsTransactional(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterAIRoutes(mux, drv)

	ctx := context.Background()
	tx, _ := drv.Begin(ctx, store.TxOptions{})
	prompt := "the actual prompt with PII"
	completion := "the actual completion"
	tr, err := tx.AppendAITrace(ctx, &store.AITrace{
		TenantID: "tenant_default", Status: "success", Model: "gpt-4",
		InputTokens: 1, OutputTokens: 1, DurationMS: 1,
		Prompt: &prompt, Completion: &completion,
		OccurredAt: time.Now().UTC(),
	})
	if err != nil {
		t.Fatalf("AppendAITrace: %v", err)
	}
	_ = tx.Commit()

	// Reveal with valid reason.
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, authedTenantRequest(t, drv,
		http.MethodPost, "/api/v1/t/default/ai/traces/"+tr.ID+"/reveal", "default",
		map[string]any{"reason": "investigation #1234 for incident review"}))
	if rec.Code != http.StatusOK {
		t.Fatalf("reveal: expected 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	var got aiTraceResponse
	_ = json.NewDecoder(rec.Body).Decode(&got)
	if got.Prompt == nil || *got.Prompt != prompt {
		t.Errorf("reveal prompt: got %v want %q", got.Prompt, prompt)
	}
	if got.Completion == nil || *got.Completion != completion {
		t.Errorf("reveal completion: got %v want %q", got.Completion, completion)
	}

	// Audit row check.
	tx2, _ := drv.Begin(ctx, store.TxOptions{ReadOnly: true})
	defer func() { _ = tx2.Rollback() }()
	entries, err := tx2.QueryAuditLog(ctx, store.AuditQuery{Limit: 100})
	if err != nil {
		t.Fatalf("QueryAuditLog: %v", err)
	}
	found := false
	for _, e := range entries {
		if e.GetPayloadSchema() == "ai.trace_sensitive_revealed.v1" && e.GetEntityId() == tr.ID {
			found = true
			if e.GetOperation() != "reveal" {
				t.Errorf("audit operation: got %q want %q", e.GetOperation(), "reveal")
			}
		}
	}
	if !found {
		t.Errorf("expected audit entry of schema ai.trace_sensitive_revealed.v1 for trace %s", tr.ID)
	}
}

func TestAIMCPServers_CRUD(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterAIRoutes(mux, drv)

	body := map[string]any{"name": "mcp1", "url": "https://mcp.example.com"}
	r := httptest.NewRecorder()
	mux.ServeHTTP(r, authedTenantRequest(t, drv,
		http.MethodPost, "/api/v1/t/default/ai/mcp-servers", "default", body))
	if r.Code != http.StatusCreated {
		t.Fatalf("create: %d", r.Code)
	}
}
