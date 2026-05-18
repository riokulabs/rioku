package keyvalidator_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/riokulabs/rioku/internal/keyvalidator"
	"github.com/riokulabs/rioku/internal/observability"
	"github.com/riokulabs/rioku/internal/store"
	_ "github.com/riokulabs/rioku/internal/store/sqlite"
)

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

func hashKey(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

// invokeValidator drives the handler in-process via httptest.
func invokeValidator(t *testing.T, srv *keyvalidator.Server, body string) *httptest.ResponseRecorder {
	t.Helper()
	// Reuse the package's POST handler by going through a direct
	// in-process http call against an httptest mux. The Server
	// uses a private mux; we drive it via an exported helper if
	// available, otherwise via a real listener.
	if err := srv.Listen("127.0.0.1:0"); err != nil {
		t.Fatalf("Listen: %v", err)
	}
	go func() {
		_ = srv.Serve()
	}()
	t.Cleanup(func() { _ = srv.Shutdown(context.Background()) })

	req, err := http.NewRequest(http.MethodPost, "http://"+srv.Addr()+"/validate-key", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("client.Do: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	rec := httptest.NewRecorder()
	rec.Code = resp.StatusCode
	for k, v := range resp.Header {
		rec.Header()[k] = v
	}
	buf := &bytes.Buffer{}
	if _, err := buf.ReadFrom(resp.Body); err != nil {
		t.Fatal(err)
	}
	rec.Body = buf
	return rec
}

func decodeResp(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("json.Unmarshal(%q): %v", rec.Body.String(), err)
	}
	return out
}

func TestValidator_ValidStandaloneKey(t *testing.T) {
	d := openDB(t)
	ctx := store.WithTenantID(context.Background(), "tenant_default")

	rawKey := "sk-live-" + uuid.NewString()
	hash := hashKey(rawKey)
	tx, _ := d.Begin(ctx, store.TxOptions{})
	if _, err := tx.CreateAPIKey(ctx, "live", hash, "", []string{"keys:demo"}, nil, ""); err != nil {
		t.Fatal(err)
	}
	_ = tx.Commit()

	srv := keyvalidator.New(d, slog.Default())
	body, _ := json.Marshal(map[string]string{"key_hash": hash})
	rec := invokeValidator(t, srv, string(body))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body)
	}
	got := decodeResp(t, rec)
	if got["valid"] != true {
		t.Fatalf("valid = %v, want true; full: %v", got["valid"], got)
	}
	if scopes, ok := got["scopes"].([]any); !ok || len(scopes) != 1 {
		t.Errorf("scopes = %v, want one entry", got["scopes"])
	}
}

func TestValidator_MissingKeyReturnsReasonMissing(t *testing.T) {
	d := openDB(t)
	srv := keyvalidator.New(d, slog.Default())
	body, _ := json.Marshal(map[string]string{"key_hash": hashKey("never-issued")})
	rec := invokeValidator(t, srv, string(body))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	got := decodeResp(t, rec)
	if got["valid"] != false {
		t.Fatalf("valid = %v, want false", got["valid"])
	}
	if got["reason"] != "missing" {
		t.Errorf("reason = %v, want missing", got["reason"])
	}
}

func TestValidator_RevokedKey(t *testing.T) {
	d := openDB(t)
	ctx := store.WithTenantID(context.Background(), "tenant_default")

	rawKey := "sk-revoked-" + uuid.NewString()
	hash := hashKey(rawKey)
	tx, _ := d.Begin(ctx, store.TxOptions{})
	keyID, _ := tx.CreateAPIKey(ctx, "x", hash, "", []string{}, nil, "")
	_ = tx.RevokeAPIKey(ctx, keyID)
	_ = tx.Commit()

	srv := keyvalidator.New(d, slog.Default())
	body, _ := json.Marshal(map[string]string{"key_hash": hash})
	rec := invokeValidator(t, srv, string(body))

	got := decodeResp(t, rec)
	if got["valid"] != false || got["reason"] != "revoked" {
		t.Fatalf("revoked path failed: %v", got)
	}
}

func TestValidator_MalformedRequestRejected(t *testing.T) {
	d := openDB(t)
	srv := keyvalidator.New(d, slog.Default())
	rec := invokeValidator(t, srv, `{`) // not valid JSON

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestValidator_GETRejected(t *testing.T) {
	d := openDB(t)
	srv := keyvalidator.New(d, slog.Default())
	if err := srv.Listen("127.0.0.1:0"); err != nil {
		t.Fatal(err)
	}
	go func() { _ = srv.Serve() }()
	t.Cleanup(func() { _ = srv.Shutdown(context.Background()) })

	resp, err := http.Get("http://" + srv.Addr() + "/validate-key")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405", resp.StatusCode)
	}
}

func TestValidator_EmptyKeyHashReturnsMissing(t *testing.T) {
	d := openDB(t)
	srv := keyvalidator.New(d, slog.Default())
	rec := invokeValidator(t, srv, `{"key_hash": ""}`)

	got := decodeResp(t, rec)
	if got["valid"] != false || got["reason"] != "missing" {
		t.Fatalf("empty-hash path failed: %v", got)
	}
}

// invokeQuotaExceeded drives the /quota-exceeded handler in-process.
func invokeQuotaExceeded(t *testing.T, srv *keyvalidator.Server, body string) int {
	t.Helper()
	if err := srv.Listen("127.0.0.1:0"); err != nil {
		t.Fatalf("Listen: %v", err)
	}
	go func() { _ = srv.Serve() }()
	t.Cleanup(func() { _ = srv.Shutdown(context.Background()) })

	resp, err := http.Post("http://"+srv.Addr()+"/quota-exceeded", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	return resp.StatusCode
}

func TestQuotaExceeded_FiresHookOnFirstEvent(t *testing.T) {
	d := openDB(t)
	srv := keyvalidator.New(d, slog.Default())
	var fired int
	var mu sync.Mutex
	var lastEv keyvalidator.QuotaExceededEvent
	srv.SetQuotaWebhook(func(_ context.Context, ev keyvalidator.QuotaExceededEvent) {
		mu.Lock()
		defer mu.Unlock()
		fired++
		lastEv = ev
	})
	body := `{"api_key_hash":"abc123","plan_id":"plan_pro","tenant_id":"tenant_default","limit":10,"count":11}`
	if status := invokeQuotaExceeded(t, srv, body); status != http.StatusAccepted {
		t.Errorf("status = %d, want 202", status)
	}
	mu.Lock()
	defer mu.Unlock()
	if fired != 1 {
		t.Errorf("fired = %d, want 1", fired)
	}
	if lastEv.PlanID != "plan_pro" || lastEv.Limit != 10 || lastEv.Count != 11 {
		t.Errorf("event = %+v", lastEv)
	}
}

func TestQuotaExceeded_DedupesWithinDay(t *testing.T) {
	d := openDB(t)
	srv := keyvalidator.New(d, slog.Default())
	var fired int
	var mu sync.Mutex
	srv.SetQuotaWebhook(func(_ context.Context, _ keyvalidator.QuotaExceededEvent) {
		mu.Lock()
		fired++
		mu.Unlock()
	})

	if err := srv.Listen("127.0.0.1:0"); err != nil {
		t.Fatal(err)
	}
	go func() { _ = srv.Serve() }()
	t.Cleanup(func() { _ = srv.Shutdown(context.Background()) })

	body := `{"api_key_hash":"abc","plan_id":"plan_pro","tenant_id":"tenant_default","limit":1,"count":2}`
	for i := 0; i < 5; i++ {
		resp, err := http.Post("http://"+srv.Addr()+"/quota-exceeded", "application/json", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
	}

	mu.Lock()
	defer mu.Unlock()
	if fired != 1 {
		t.Errorf("fired = %d, want 1 (dedupe within day)", fired)
	}
}

func TestQuotaExceeded_SkipsMalformed(t *testing.T) {
	d := openDB(t)
	srv := keyvalidator.New(d, slog.Default())
	var fired int
	srv.SetQuotaWebhook(func(_ context.Context, _ keyvalidator.QuotaExceededEvent) {
		fired++
	})
	if status := invokeQuotaExceeded(t, srv, `{"api_key_hash":"","plan_id":"x","tenant_id":"y"}`); status != http.StatusAccepted {
		t.Errorf("status = %d, want 202 (skip but accept)", status)
	}
	if fired != 0 {
		t.Errorf("fired = %d, want 0 for empty hash", fired)
	}
}

func TestJWKSRefresh_RecordsErrorEvent(t *testing.T) {
	d := openDB(t)
	srv := keyvalidator.New(d, slog.Default())
	srv.JWKS = observability.NewJWKSRegistry()
	if err := srv.Listen("127.0.0.1:0"); err != nil {
		t.Fatalf("Listen: %v", err)
	}
	go func() { _ = srv.Serve() }()
	t.Cleanup(func() { _ = srv.Shutdown(context.Background()) })

	body := `{"url":"https://idp/.well-known/jwks.json","status":"error","error":"timeout","at":"2026-05-01T00:00:00Z"}`
	req, err := http.NewRequest(http.MethodPost, "http://"+srv.Addr()+"/jwks-refresh", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}

	snap := srv.JWKS.Snapshot()
	if len(snap) != 1 {
		t.Fatalf("snapshot len = %d, want 1", len(snap))
	}
	if snap[0].Status != observability.JWKSStatusError {
		t.Errorf("Status = %q", snap[0].Status)
	}
	if snap[0].LastError != "timeout" {
		t.Errorf("LastError = %q", snap[0].LastError)
	}
}

func TestJWKSRefresh_NilRegistryNoOp(t *testing.T) {
	d := openDB(t)
	srv := keyvalidator.New(d, slog.Default())
	// JWKS intentionally nil — handler should still return 200 so the
	// data-plane plugin's fire-and-forget POSTs don't generate log
	// noise on misconfigured deployments.
	if err := srv.Listen("127.0.0.1:0"); err != nil {
		t.Fatal(err)
	}
	go func() { _ = srv.Serve() }()
	t.Cleanup(func() { _ = srv.Shutdown(context.Background()) })

	body := `{"url":"u","status":"ok","at":"2026-05-01T00:00:00Z"}`
	req, _ := http.NewRequest(http.MethodPost, "http://"+srv.Addr()+"/jwks-refresh", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want 200", resp.StatusCode)
	}
}

func TestWAFRecord_WritesDenialPerMessage(t *testing.T) {
	d := openDB(t)
	srv := keyvalidator.New(d, slog.Default())
	if err := srv.Listen("127.0.0.1:0"); err != nil {
		t.Fatal(err)
	}
	go func() { _ = srv.Serve() }()
	t.Cleanup(func() { _ = srv.Shutdown(context.Background()) })

	// Two messages, one transaction — should produce two WAFDenial rows.
	// Use a non-default tenant ("acme-corp") to prove URI extraction works:
	// before the fix, all loopback denials landed under "tenant_default"
	// regardless of the actual target tenant (#207).
	const wantTenant = "acme-corp"
	const tenantURI = "/api/v1/t/acme-corp/routes/my-route"

	// Seed the tenant so the FK constraint is satisfied.
	seedTx, err := d.Begin(context.Background(), store.TxOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := seedTx.CreateTenant(context.Background(), &store.Tenant{
		ID: wantTenant, Slug: wantTenant, Name: "Acme Corp", Plan: "community", URLMode: "path",
	}); err != nil {
		_ = seedTx.Rollback()
		t.Fatal(err)
	}
	if err := seedTx.Commit(); err != nil {
		t.Fatal(err)
	}
	body := `{
		"transaction": {
			"timestamp": "01/May/2026:10:00:00 +0000",
			"unix_timestamp": 1746091200,
			"id": "txid-1",
			"client_ip": "10.0.0.5",
			"highest_severity": "WARNING",
			"is_interrupted": true,
			"request": {"method": "GET", "uri": "` + tenantURI + `"}
		},
		"messages": [
			{"actionset": "block", "message": "SQL injection attempt", "data": {"id": 942100, "msg": "SQLi", "severity": "CRITICAL"}},
			{"actionset": "block", "message": "XSS attempt", "data": {"id": 941100, "msg": "XSS", "severity": "WARNING"}}
		]
	}`

	req, _ := http.NewRequest(http.MethodPost, "http://"+srv.Addr()+"/waf-record", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}

	tx, err := d.Begin(store.WithTenantID(context.Background(), wantTenant), store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback() }()
	denials, err := tx.QueryWAFDenials(store.WithTenantID(context.Background(), wantTenant), store.WAFDenialQuery{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(denials) != 2 {
		t.Fatalf("denials len = %d, want 2", len(denials))
	}
	wantRules := map[string]bool{"942100": false, "941100": false}
	for _, d := range denials {
		if d.RequestURI != tenantURI {
			t.Errorf("RequestURI = %q, want %q", d.RequestURI, tenantURI)
		}
		if d.TenantID != wantTenant {
			t.Errorf("TenantID = %q, want %q", d.TenantID, wantTenant)
		}
		if d.ClientIP != "10.0.0.5" {
			t.Errorf("ClientIP = %q", d.ClientIP)
		}
		if d.Action != "block" {
			t.Errorf("Action = %q", d.Action)
		}
		if _, ok := wantRules[d.RuleID]; ok {
			wantRules[d.RuleID] = true
		}
	}
	for r, seen := range wantRules {
		if !seen {
			t.Errorf("rule %s not present in denials", r)
		}
	}
}

func TestWAFRecord_AdminURIFallsBackToDefaultTenant(t *testing.T) {
	d := openDB(t)
	srv := keyvalidator.New(d, slog.Default())
	if err := srv.Listen("127.0.0.1:0"); err != nil {
		t.Fatal(err)
	}
	go func() { _ = srv.Serve() }()
	t.Cleanup(func() { _ = srv.Shutdown(context.Background()) })

	// Admin-scoped URI — no tenant segment, falls back to store.DefaultTenantID.
	body := `{
		"transaction": {
			"unix_timestamp": 1746091200,
			"id": "txid-admin",
			"client_ip": "127.0.0.1",
			"is_interrupted": true,
			"request": {"method": "GET", "uri": "/api/v1/admin/tenants"}
		},
		"messages": [
			{"actionset": "block", "message": "probe", "data": {"id": 1, "msg": "probe", "severity": "LOW"}}
		]
	}`

	req, _ := http.NewRequest(http.MethodPost, "http://"+srv.Addr()+"/waf-record", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, _ := http.DefaultClient.Do(req)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}

	tx, _ := d.Begin(store.WithTenantID(context.Background(), store.DefaultTenantID), store.TxOptions{ReadOnly: true})
	defer func() { _ = tx.Rollback() }()
	denials, _ := tx.QueryWAFDenials(store.WithTenantID(context.Background(), store.DefaultTenantID), store.WAFDenialQuery{Limit: 10})
	if len(denials) != 1 {
		t.Fatalf("denials len = %d, want 1", len(denials))
	}
	if denials[0].TenantID != store.DefaultTenantID {
		t.Errorf("TenantID = %q, want %q", denials[0].TenantID, store.DefaultTenantID)
	}
}

func TestWAFRecord_NoMessagesNoOp(t *testing.T) {
	d := openDB(t)
	srv := keyvalidator.New(d, slog.Default())
	if err := srv.Listen("127.0.0.1:0"); err != nil {
		t.Fatal(err)
	}
	go func() { _ = srv.Serve() }()
	t.Cleanup(func() { _ = srv.Shutdown(context.Background()) })

	body := `{"transaction":{"id":"x","client_ip":"1.2.3.4","unix_timestamp":1746091200,"is_interrupted":false},"messages":[]}`
	req, _ := http.NewRequest(http.MethodPost, "http://"+srv.Addr()+"/waf-record", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, _ := http.DefaultClient.Do(req)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}

	tx, _ := d.Begin(store.WithTenantID(context.Background(), "tenant_default"), store.TxOptions{ReadOnly: true})
	defer func() { _ = tx.Rollback() }()
	denials, _ := tx.QueryWAFDenials(store.WithTenantID(context.Background(), "tenant_default"), store.WAFDenialQuery{Limit: 10})
	if len(denials) != 0 {
		t.Errorf("denials = %d, want 0 for empty messages", len(denials))
	}
}

func TestJWKSRefresh_AutoTimestamp(t *testing.T) {
	d := openDB(t)
	srv := keyvalidator.New(d, slog.Default())
	srv.JWKS = observability.NewJWKSRegistry()
	if err := srv.Listen("127.0.0.1:0"); err != nil {
		t.Fatal(err)
	}
	go func() { _ = srv.Serve() }()
	t.Cleanup(func() { _ = srv.Shutdown(context.Background()) })

	// No At — server must stamp time.Now.
	body := `{"url":"u","status":"ok"}`
	req, _ := http.NewRequest(http.MethodPost, "http://"+srv.Addr()+"/jwks-refresh", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()

	snap := srv.JWKS.Snapshot()
	if len(snap) != 1 {
		t.Fatalf("snapshot len = %d", len(snap))
	}
	if snap[0].LastRefreshAt.IsZero() {
		t.Error("LastRefreshAt is zero — server should stamp time.Now when At missing")
	}
	if time.Since(snap[0].LastRefreshAt) > time.Minute {
		t.Errorf("LastRefreshAt %v not recent", snap[0].LastRefreshAt)
	}
}
