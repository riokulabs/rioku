package aigateway_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/riokulabs/rioku/internal/ai/registry"
	"github.com/riokulabs/rioku/internal/aigateway"
	"github.com/riokulabs/rioku/internal/store"
)

// startAIGatewayWithRegistry mirrors startAIGateway but injects a
// model registry so cost calc + the X-Rioku-Response-Cost header
// run.
func startAIGatewayWithRegistry(t *testing.T, d store.Driver) string {
	t.Helper()
	reg, err := registry.New()
	if err != nil {
		t.Fatalf("registry.New: %v", err)
	}
	srv := aigateway.New(d, nil, reg, nil)
	if err := srv.Listen("127.0.0.1:0"); err != nil {
		t.Fatalf("Listen: %v", err)
	}
	go func() { _ = srv.Serve() }()
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = srv.Shutdown(ctx)
	})
	return "http://" + srv.Addr()
}

func TestAIGateway_CostHeaderEmitted(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		// Surface a usage block — the gateway should prefer it
		// over the heuristic and price the response accordingly.
		_, _ = w.Write([]byte(`{"id":"chatcmpl-1","object":"chat.completion","usage":{"prompt_tokens":50,"completion_tokens":100,"total_tokens":150}}`))
	}))
	defer upstream.Close()

	d := openDB(t)
	_, vkID := seedProviderAndVK(t, d, upstream.URL, "gpt-4o")
	base := startAIGatewayWithRegistry(t, d)

	req, _ := http.NewRequest(http.MethodPost, base+"/v1/chat/completions",
		strings.NewReader(`{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}`))
	req.Header.Set("X-Rioku-Tenant-Id", "tenant_default")
	req.Header.Set("X-Rioku-Virtual-Key", vkID)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()

	costHeader := resp.Header.Get("X-Rioku-Response-Cost")
	if costHeader == "" {
		t.Error("X-Rioku-Response-Cost header missing")
	}
	// gpt-4o pricing > 0; cost should be a non-zero formatted float.
	if costHeader == "0.000000" {
		t.Errorf("cost header = %q, expected non-zero for gpt-4o", costHeader)
	}

	// Spend log captures usage values.
	time.Sleep(60 * time.Millisecond)
	ctx := store.WithTenantID(context.Background(), "tenant_default")
	tx, _ := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	defer tx.Rollback() //nolint:errcheck
	logs, _ := tx.QueryAISpendLogs(ctx, store.AISpendQuery{})
	if len(logs) != 1 {
		t.Fatalf("len(logs) = %d, want 1", len(logs))
	}
	if logs[0].InputTokens != 50 || logs[0].OutputTokens != 100 {
		t.Errorf("tokens = %d/%d, want 50/100 (from upstream usage)", logs[0].InputTokens, logs[0].OutputTokens)
	}
	if logs[0].CostUSD <= 0 {
		t.Errorf("CostUSD = %f, want > 0", logs[0].CostUSD)
	}
}

func TestAIGateway_TokenHeuristicWhenUsageMissing(t *testing.T) {
	// Streaming path or no-usage response — gateway should fall
	// back to the byte-based output token estimate.
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":"x","object":"chat.completion"}`)) // no usage
	}))
	defer upstream.Close()

	d := openDB(t)
	_, vkID := seedProviderAndVK(t, d, upstream.URL, "gpt-4o")
	base := startAIGatewayWithRegistry(t, d)

	body := `{"model":"gpt-4o","messages":[{"role":"user","content":"This is a fairly long prompt to chew on so heuristic returns nonzero."}]}`
	req, _ := http.NewRequest(http.MethodPost, base+"/v1/chat/completions",
		strings.NewReader(body))
	req.Header.Set("X-Rioku-Tenant-Id", "tenant_default")
	req.Header.Set("X-Rioku-Virtual-Key", vkID)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()

	time.Sleep(60 * time.Millisecond)
	ctx := store.WithTenantID(context.Background(), "tenant_default")
	tx, _ := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	defer tx.Rollback() //nolint:errcheck
	logs, _ := tx.QueryAISpendLogs(ctx, store.AISpendQuery{})
	if len(logs) != 1 {
		t.Fatalf("len = %d", len(logs))
	}
	if logs[0].InputTokens == 0 {
		t.Error("InputTokens = 0; heuristic should produce a positive count")
	}
	// Output tokens come from byte heuristic — small but positive.
	if logs[0].OutputTokens == 0 {
		t.Error("OutputTokens = 0; byte heuristic should produce a positive count")
	}
}

// seedVKWithBudget creates a vk with a small budget then preloads
// a spend log that consumes more than the budget. The gateway
// should reject the next call with 403 + RFC 7807 body.
func TestAIGateway_BudgetExceededReturns7807(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()

	d := openDB(t)
	ctx := store.WithTenantID(context.Background(), "tenant_default")

	// Provider + vk with a $0.01 month budget.
	tx, _ := d.Begin(ctx, store.TxOptions{})
	cred := "secret"
	p, _ := tx.CreateAIProvider(ctx, &store.AIProvider{
		ID: "prov_" + uuid.NewString(), TenantID: "tenant_default",
		Name: "p", Kind: "openai", BaseURL: upstream.URL, Credential: &cred,
		Enabled: true, Metadata: "{}",
	})
	vk, _ := tx.CreateVirtualKey(ctx, store.CreateVirtualKeyParams{
		ID:            "vk_budget",
		TenantID:      "tenant_default",
		Name:          "tight-" + uuid.NewString()[:6],
		ProviderID:    p.ID,
		AllowedModels: []string{"gpt-4o"},
		BudgetUSD:     0.01,
		BudgetWindow:  store.BudgetWindowMonth,
	})
	// Preload spend that exceeds budget.
	vkID := vk.ID
	_ = tx.AppendAISpendLog(ctx, &store.AISpendLog{
		ID: "spend_" + uuid.NewString(), TenantID: "tenant_default",
		VirtualKeyID: &vkID, ModelID: "gpt-4o",
		CostUSD: 0.99, Status: "ok", RequestID: "preload",
	})
	_ = tx.Commit()

	base := startAIGatewayWithRegistry(t, d)
	req, _ := http.NewRequest(http.MethodPost, base+"/v1/chat/completions",
		strings.NewReader(`{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}`))
	req.Header.Set("X-Rioku-Tenant-Id", "tenant_default")
	req.Header.Set("X-Rioku-Virtual-Key", vkID)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("status = %d, want 403", resp.StatusCode)
	}
	if got := resp.Header.Get("Content-Type"); got != "application/problem+json" {
		t.Errorf("Content-Type = %q, want application/problem+json", got)
	}
}

func TestAIGateway_BudgetZeroDisablesEnforcement(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()

	d := openDB(t)
	_, vkID := seedProviderAndVK(t, d, upstream.URL, "gpt-4o") // BudgetUSD=0 from helper
	base := startAIGatewayWithRegistry(t, d)

	req, _ := http.NewRequest(http.MethodPost, base+"/v1/chat/completions",
		strings.NewReader(`{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}`))
	req.Header.Set("X-Rioku-Tenant-Id", "tenant_default")
	req.Header.Set("X-Rioku-Virtual-Key", vkID)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want 200 (budget=0 disables enforcement)", resp.StatusCode)
	}
}
