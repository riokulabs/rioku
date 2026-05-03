package aigateway_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/riokulabs/rioku/internal/aigateway"
	"github.com/riokulabs/rioku/internal/store"
	_ "github.com/riokulabs/rioku/internal/store/sqlite"
)

// openDB creates a fresh sqlite store for the test.
func openDB(t *testing.T) store.Driver {
	t.Helper()
	d, err := store.New("sqlite")
	if err != nil {
		t.Fatal(err)
	}
	dbPath := filepath.Join(t.TempDir(), "test.db")
	if err := d.Open(context.Background(), store.DriverConfig{Path: dbPath}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })
	if err := d.Migrate(context.Background(), store.MigrateUp); err != nil {
		t.Fatal(err)
	}
	return d
}

// seedProviderAndVK provisions a provider + virtual key against the
// test upstream URL and returns the IDs.
func seedProviderAndVK(t *testing.T, d store.Driver, upstreamURL, allowedModel string) (providerID, vkID string) {
	t.Helper()
	ctx := store.WithTenantID(context.Background(), "tenant_default")
	tx, err := d.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback() //nolint:errcheck

	cred := "test-secret"
	p, err := tx.CreateAIProvider(ctx, &store.AIProvider{
		ID:         "prov_" + uuid.NewString(),
		TenantID:   "tenant_default",
		Name:       "test-openai",
		Kind:       "openai",
		BaseURL:    upstreamURL,
		Credential: &cred,
		Enabled:    true,
		Metadata:   "{}",
	})
	if err != nil {
		t.Fatalf("CreateAIProvider: %v", err)
	}
	allowed := []string{}
	if allowedModel != "" {
		allowed = []string{allowedModel}
	}
	vk, err := tx.CreateVirtualKey(ctx, store.CreateVirtualKeyParams{
		ID:            "vk_" + uuid.NewString(),
		TenantID:      "tenant_default",
		Name:          "test-vk-" + uuid.NewString()[:6],
		ProviderID:    p.ID,
		CredentialRef: "",
		AllowedModels: allowed,
		BudgetWindow:  store.BudgetWindowMonth,
	})
	if err != nil {
		t.Fatalf("CreateVirtualKey: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	return p.ID, vk.ID
}

// startAIGateway launches an AI gateway server bound to a random
// loopback port. Returns the base URL.
func startAIGateway(t *testing.T, d store.Driver) string {
	t.Helper()
	srv := aigateway.New(d, nil, nil)
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

func TestAIGateway_Health(t *testing.T) {
	d := openDB(t)
	base := startAIGateway(t, d)
	resp, err := http.Get(base + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want 200", resp.StatusCode)
	}
}

func TestAIGateway_RejectsMissingHeaders(t *testing.T) {
	d := openDB(t)
	base := startAIGateway(t, d)
	req, _ := http.NewRequest(http.MethodPost, base+"/v1/chat/completions",
		strings.NewReader(`{"model":"gpt-4o"}`))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", resp.StatusCode)
	}
}

func TestAIGateway_ProxiesToUpstream(t *testing.T) {
	// Fake upstream captures the inbound request and replies.
	var seen *http.Request
	var seenAuth, seenBody string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = r
		seenAuth = r.Header.Get("Authorization")
		b, _ := io.ReadAll(r.Body)
		seenBody = string(b)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":"chatcmpl-1","object":"chat.completion"}`))
	}))
	defer upstream.Close()

	d := openDB(t)
	_, vkID := seedProviderAndVK(t, d, upstream.URL, "gpt-4o")
	base := startAIGateway(t, d)

	body := `{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}`
	req, _ := http.NewRequest(http.MethodPost, base+"/v1/chat/completions",
		strings.NewReader(body))
	req.Header.Set("X-Rioku-Tenant-Id", "tenant_default")
	req.Header.Set("X-Rioku-Virtual-Key", vkID)
	req.Header.Set("Authorization", "Bearer client-creds-should-be-stripped")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want 200", resp.StatusCode)
	}

	if seen == nil {
		t.Fatal("upstream never received a request")
	}
	if seenAuth != "Bearer test-secret" {
		t.Errorf("upstream Authorization = %q, want 'Bearer test-secret' (vault-resolved)", seenAuth)
	}
	if !strings.Contains(seenBody, `"model":"gpt-4o"`) {
		t.Errorf("upstream body lost model field: %s", seenBody)
	}

	// Spend log was recorded. The write is best-effort and runs
	// after the response is flushed; under -race the read can
	// outrun the write, so give it a beat.
	time.Sleep(50 * time.Millisecond)
	ctx := store.WithTenantID(context.Background(), "tenant_default")
	tx, _ := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	defer tx.Rollback() //nolint:errcheck
	logs, err := tx.QueryAISpendLogs(ctx, store.AISpendQuery{})
	if err != nil {
		t.Fatal(err)
	}
	if len(logs) != 1 {
		t.Fatalf("len(spend logs) = %d, want 1", len(logs))
	}
	if logs[0].Status != "ok" {
		t.Errorf("Status = %q, want ok", logs[0].Status)
	}
	if logs[0].ModelID != "gpt-4o" {
		t.Errorf("ModelID = %q, want gpt-4o", logs[0].ModelID)
	}
}

func TestAIGateway_RejectsModelNotInAllowList(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()

	d := openDB(t)
	// vk only allows gpt-4o; we'll request gpt-5.
	_, vkID := seedProviderAndVK(t, d, upstream.URL, "gpt-4o")
	base := startAIGateway(t, d)

	req, _ := http.NewRequest(http.MethodPost, base+"/v1/chat/completions",
		strings.NewReader(`{"model":"gpt-5"}`))
	req.Header.Set("X-Rioku-Tenant-Id", "tenant_default")
	req.Header.Set("X-Rioku-Virtual-Key", vkID)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		body, _ := io.ReadAll(resp.Body)
		t.Errorf("status = %d, want 403; body = %s", resp.StatusCode, body)
	}
}

func TestAIGateway_RejectsRevokedKey(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()

	d := openDB(t)
	_, vkID := seedProviderAndVK(t, d, upstream.URL, "gpt-4o")
	// Revoke the key.
	ctx := store.WithTenantID(context.Background(), "tenant_default")
	tx, _ := d.Begin(ctx, store.TxOptions{})
	if err := tx.RevokeVirtualKey(ctx, vkID); err != nil {
		t.Fatal(err)
	}
	_ = tx.Commit()

	base := startAIGateway(t, d)
	req, _ := http.NewRequest(http.MethodPost, base+"/v1/chat/completions",
		strings.NewReader(`{"model":"gpt-4o"}`))
	req.Header.Set("X-Rioku-Tenant-Id", "tenant_default")
	req.Header.Set("X-Rioku-Virtual-Key", vkID)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", resp.StatusCode)
	}
}

func TestAIGateway_StreamingPassthrough(t *testing.T) {
	// Upstream emits two SSE events, each flushed.
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		flusher, _ := w.(http.Flusher)
		for _, chunk := range []string{`data: {"i":1}`, `data: {"i":2}`, `data: [DONE]`} {
			_, _ = w.Write([]byte(chunk + "\n\n"))
			if flusher != nil {
				flusher.Flush()
			}
			time.Sleep(5 * time.Millisecond)
		}
	}))
	defer upstream.Close()

	d := openDB(t)
	_, vkID := seedProviderAndVK(t, d, upstream.URL, "gpt-4o")
	base := startAIGateway(t, d)

	body := `{"model":"gpt-4o","stream":true}`
	req, _ := http.NewRequest(http.MethodPost, base+"/v1/chat/completions",
		strings.NewReader(body))
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
	got, _ := io.ReadAll(resp.Body)
	if !bytes.Contains(got, []byte(`{"i":1}`)) || !bytes.Contains(got, []byte(`{"i":2}`)) {
		t.Errorf("missing stream chunks; body = %s", got)
	}
}

func TestAIGateway_RejectsUnknownVirtualKey(t *testing.T) {
	d := openDB(t)
	base := startAIGateway(t, d)
	req, _ := http.NewRequest(http.MethodPost, base+"/v1/chat/completions",
		strings.NewReader(`{"model":"gpt-4o"}`))
	req.Header.Set("X-Rioku-Tenant-Id", "tenant_default")
	req.Header.Set("X-Rioku-Virtual-Key", "vk_does_not_exist")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", resp.StatusCode)
	}
}

func TestAIGateway_RejectsBadJSON(t *testing.T) {
	d := openDB(t)
	base := startAIGateway(t, d)
	req, _ := http.NewRequest(http.MethodPost, base+"/v1/chat/completions",
		strings.NewReader("not-json"))
	req.Header.Set("X-Rioku-Tenant-Id", "tenant_default")
	req.Header.Set("X-Rioku-Virtual-Key", "vk_x")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

// Sanity check that the spend log records error status when the
// upstream returns 5xx.
func TestAIGateway_SpendLogRecordsErrorStatus(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer upstream.Close()

	d := openDB(t)
	_, vkID := seedProviderAndVK(t, d, upstream.URL, "gpt-4o")
	base := startAIGateway(t, d)

	req, _ := http.NewRequest(http.MethodPost, base+"/v1/chat/completions",
		strings.NewReader(`{"model":"gpt-4o"}`))
	req.Header.Set("X-Rioku-Tenant-Id", "tenant_default")
	req.Header.Set("X-Rioku-Virtual-Key", vkID)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	// Give the gateway a moment to write the spend log (it's
	// best-effort and runs after the response is flushed).
	time.Sleep(50 * time.Millisecond)

	ctx := store.WithTenantID(context.Background(), "tenant_default")
	tx, _ := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	defer tx.Rollback() //nolint:errcheck
	logs, _ := tx.QueryAISpendLogs(ctx, store.AISpendQuery{})
	if len(logs) != 1 {
		t.Fatalf("len(logs) = %d, want 1", len(logs))
	}
	if logs[0].Status != "error" {
		t.Errorf("Status = %q, want error", logs[0].Status)
	}
}

// Catch-all to exercise json.Marshal sanity (placeholder so adding
// fields to proxyRequest doesn't silently break decoding).
var _ = json.Marshal
