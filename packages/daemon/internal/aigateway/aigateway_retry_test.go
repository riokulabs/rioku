package aigateway_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/riokulabs/rioku/internal/ai/registry"
	"github.com/riokulabs/rioku/internal/aigateway"
	"github.com/riokulabs/rioku/internal/store"
)

// startAIGatewayMulti spins up a gateway with the model registry
// (so cost calc runs) and returns the base URL.
func startAIGatewayMulti(t *testing.T, d store.Driver) string {
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

// seedTwoProvidersAndVK creates two providers + a vk whose
// upstream list points at both with the given priorities.
func seedTwoProvidersAndVK(t *testing.T, d store.Driver, primaryURL, secondaryURL string, strategy string) (vkID, primaryID, secondaryID string) {
	t.Helper()
	ctx := store.WithTenantID(context.Background(), "tenant_default")
	tx, _ := d.Begin(ctx, store.TxOptions{})

	cred1 := "secret-1"
	p1, err := tx.CreateAIProvider(ctx, &store.AIProvider{
		ID: "prov_" + uuid.NewString(), TenantID: "tenant_default",
		Name: "primary-" + uuid.NewString()[:6], Kind: "openai",
		BaseURL: primaryURL, Credential: &cred1, Enabled: true, Metadata: "{}",
	})
	if err != nil {
		t.Fatal(err)
	}
	cred2 := "secret-2"
	p2, err := tx.CreateAIProvider(ctx, &store.AIProvider{
		ID: "prov_" + uuid.NewString(), TenantID: "tenant_default",
		Name: "secondary-" + uuid.NewString()[:6], Kind: "openai",
		BaseURL: secondaryURL, Credential: &cred2, Enabled: true, Metadata: "{}",
	})
	if err != nil {
		t.Fatal(err)
	}
	vk, err := tx.CreateVirtualKey(ctx, store.CreateVirtualKeyParams{
		ID:            "vk_multi_" + uuid.NewString()[:6],
		TenantID:      "tenant_default",
		Name:          "multi-" + uuid.NewString()[:6],
		ProviderID:    p1.ID, // legacy fallback; ignored when Upstreams is non-empty
		AllowedModels: []string{"gpt-4o"},
		BudgetWindow:  store.BudgetWindowMonth,
		Upstreams: []store.VirtualKeyUpstream{
			{ProviderID: p1.ID, Weight: 1, Priority: 0}, // primary
			{ProviderID: p2.ID, Weight: 1, Priority: 1}, // secondary
		},
		RoutingStrategy: strategy,
		RoutingConfig:   "{}",
	})
	if err != nil {
		t.Fatal(err)
	}
	_ = tx.Commit()
	return vk.ID, p1.ID, p2.ID
}

func TestAIGateway_FallbackOn5xxAdvancesChain(t *testing.T) {
	var primaryHits, secondaryHits int32
	primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&primaryHits, 1)
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"primary-down"}`))
	}))
	defer primary.Close()
	secondary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&secondaryHits, 1)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":"chatcmpl-2","usage":{"prompt_tokens":10,"completion_tokens":5}}`))
	}))
	defer secondary.Close()

	d := openDB(t)
	vkID, _, _ := seedTwoProvidersAndVK(t, d, primary.URL, secondary.URL, "fallback")
	base := startAIGatewayMulti(t, d)

	req, _ := http.NewRequest(http.MethodPost, base+"/v1/chat/completions",
		strings.NewReader(`{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}`))
	req.Header.Set("X-Rioku-Tenant-Id", "tenant_default")
	req.Header.Set("X-Rioku-Virtual-Key", vkID)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want 200 (fallback should succeed)", resp.StatusCode)
	}
	if got := atomic.LoadInt32(&primaryHits); got != 1 {
		t.Errorf("primaryHits = %d, want 1", got)
	}
	if got := atomic.LoadInt32(&secondaryHits); got != 1 {
		t.Errorf("secondaryHits = %d, want 1 (fallback advanced chain)", got)
	}
}

func TestAIGateway_FallbackDoesNotAdvanceOn4xx(t *testing.T) {
	var primaryHits, secondaryHits int32
	primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&primaryHits, 1)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"unauthorized"}`))
	}))
	defer primary.Close()
	secondary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&secondaryHits, 1)
		w.WriteHeader(http.StatusOK)
	}))
	defer secondary.Close()

	d := openDB(t)
	vkID, _, _ := seedTwoProvidersAndVK(t, d, primary.URL, secondary.URL, "fallback")
	base := startAIGatewayMulti(t, d)

	req, _ := http.NewRequest(http.MethodPost, base+"/v1/chat/completions",
		strings.NewReader(`{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}`))
	req.Header.Set("X-Rioku-Tenant-Id", "tenant_default")
	req.Header.Set("X-Rioku-Virtual-Key", vkID)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401 (4xx commits, no retry)", resp.StatusCode)
	}
	if got := atomic.LoadInt32(&primaryHits); got != 1 {
		t.Errorf("primaryHits = %d, want 1", got)
	}
	if got := atomic.LoadInt32(&secondaryHits); got != 0 {
		t.Errorf("secondaryHits = %d, want 0 (401 is not a fallback trigger)", got)
	}
}

func TestAIGateway_AllUpstreamsFailReturnsLast(t *testing.T) {
	primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer primary.Close()
	secondary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer secondary.Close()

	d := openDB(t)
	vkID, _, _ := seedTwoProvidersAndVK(t, d, primary.URL, secondary.URL, "fallback")
	base := startAIGatewayMulti(t, d)

	req, _ := http.NewRequest(http.MethodPost, base+"/v1/chat/completions",
		strings.NewReader(`{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}`))
	req.Header.Set("X-Rioku-Tenant-Id", "tenant_default")
	req.Header.Set("X-Rioku-Virtual-Key", vkID)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want 503 (last upstream's response surfaces)", resp.StatusCode)
	}
}

func TestAIGateway_FallbackCustomTriggerIncludes401(t *testing.T) {
	var primaryHits, secondaryHits int32
	primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&primaryHits, 1)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"key expired"}`))
	}))
	defer primary.Close()
	secondary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&secondaryHits, 1)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":"x","usage":{"prompt_tokens":1,"completion_tokens":1}}`))
	}))
	defer secondary.Close()

	d := openDB(t)
	ctx := store.WithTenantID(context.Background(), "tenant_default")
	tx, _ := d.Begin(ctx, store.TxOptions{})
	cred1 := "s1"
	p1, _ := tx.CreateAIProvider(ctx, &store.AIProvider{
		ID: "prov_" + uuid.NewString(), TenantID: "tenant_default",
		Name: "p1", Kind: "openai", BaseURL: primary.URL, Credential: &cred1,
		Enabled: true, Metadata: "{}",
	})
	cred2 := "s2"
	p2, _ := tx.CreateAIProvider(ctx, &store.AIProvider{
		ID: "prov_" + uuid.NewString(), TenantID: "tenant_default",
		Name: "p2", Kind: "openai", BaseURL: secondary.URL, Credential: &cred2,
		Enabled: true, Metadata: "{}",
	})
	vk, _ := tx.CreateVirtualKey(ctx, store.CreateVirtualKeyParams{
		ID: "vk_custom_" + uuid.NewString()[:6], TenantID: "tenant_default",
		Name:          "vk-custom-" + uuid.NewString()[:6],
		ProviderID:    p1.ID,
		AllowedModels: []string{"gpt-4o"},
		BudgetWindow:  store.BudgetWindowMonth,
		Upstreams: []store.VirtualKeyUpstream{
			{ProviderID: p1.ID, Priority: 0},
			{ProviderID: p2.ID, Priority: 1},
		},
		RoutingStrategy: "fallback",
		// Custom trigger set: 401 advances the chain (operator
		// signaled "401 means rotate to backup credential org").
		RoutingConfig: `{"triggers":[401, 503]}`,
	})
	_ = tx.Commit()

	base := startAIGatewayMulti(t, d)
	req, _ := http.NewRequest(http.MethodPost, base+"/v1/chat/completions",
		strings.NewReader(`{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}`))
	req.Header.Set("X-Rioku-Tenant-Id", "tenant_default")
	req.Header.Set("X-Rioku-Virtual-Key", vk.ID)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want 200 (custom 401 trigger advanced chain)", resp.StatusCode)
	}
	if got := atomic.LoadInt32(&primaryHits); got != 1 {
		t.Errorf("primaryHits = %d, want 1", got)
	}
	if got := atomic.LoadInt32(&secondaryHits); got != 1 {
		t.Errorf("secondaryHits = %d, want 1", got)
	}
}

func TestAIGateway_LegacyVKBypassesStrategy(t *testing.T) {
	// Legacy single-upstream VK (no Upstreams list) should not
	// touch the strategy registry — verifies backward compat.
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":"x"}`))
	}))
	defer upstream.Close()

	d := openDB(t)
	_, vkID := seedProviderAndVK(t, d, upstream.URL, "gpt-4o")
	base := startAIGatewayMulti(t, d)
	req, _ := http.NewRequest(http.MethodPost, base+"/v1/chat/completions",
		strings.NewReader(`{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}`))
	req.Header.Set("X-Rioku-Tenant-Id", "tenant_default")
	req.Header.Set("X-Rioku-Virtual-Key", vkID)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want 200", resp.StatusCode)
	}
}
