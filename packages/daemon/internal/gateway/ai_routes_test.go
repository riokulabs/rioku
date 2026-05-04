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
