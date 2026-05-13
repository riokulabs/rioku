package gateway

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/config"
	"github.com/riokulabs/rioku/internal/store"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// setupAuditExtraTestServer mirrors setupAuditTestServer but also
// mounts RegisterAuditExtraRoutes so the new chunk-6 endpoints
// (detail, stream, export, typeahead) are reachable.
func setupAuditExtraTestServer(t *testing.T) (*httptest.Server, store.Driver, *http.Client) {
	t.Helper()
	server, drv, rootPassword := setupAuditTestServer(t)
	server.Close()

	// Re-build a mux with both audit registrations.
	mux := http.NewServeMux()

	signingKey := []byte("test-signing-key-32-bytes-long!!")
	a := auth.NewAuth(signingKey, drv)
	sm := auth.NewSessionManager(drv, true)
	cfg := config.Default()
	cfg.Auth.RateLimit.RequestsPerMinute = 1000
	encKey, _ := auth.DeriveEncryptionKey(signingKey, []byte("rioku-totp-encryption-salt-v1"))
	enc, _ := auth.NewEncryptor(encKey)

	RegisterAuthRoutes(mux, a, sm, drv, cfg, enc)
	RegisterRBACRoutes(mux, drv)
	RegisterAuditRoutes(mux, drv)
	RegisterAuditExtraRoutes(mux, drv)

	var handler http.Handler = mux
	handler = SecurityHeadersMiddleware(handler)
	rl := NewRateLimiter(cfg.Auth.RateLimit)
	t.Cleanup(rl.Stop)
	handler = rl.Middleware()(handler)
	handler = AuthMiddleware(a, sm)(handler)
	handler = RequestIDMiddleware(handler)

	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)

	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}
	loginResp := doJSON(t, client, http.MethodPost, srv.URL+"/api/v1/auth/login", map[string]string{
		"username": "root",
		"password": rootPassword,
	})
	_ = loginResp.Body.Close()
	if loginResp.StatusCode != http.StatusOK {
		t.Fatalf("login failed: %d", loginResp.StatusCode)
	}
	return srv, drv, client
}

func TestAuditExtra_Detail(t *testing.T) {
	server, drv, client := setupAuditExtraTestServer(t)

	// Seed one entry directly.
	tx, _ := drv.Begin(context.Background(), store.TxOptions{})
	id := "audit-detail-1"
	_ = tx.AppendAuditEntry(context.Background(), &riokuv1.AuditEntry{
		Id:         id,
		Actor:      "alice",
		EntityType: "route",
		EntityId:   "r-1",
		Operation:  "create",
		Diff:       `{"added":"x"}`,
		OccurredAt: timestamppb.New(time.Now().UTC()),
	})
	_ = tx.Commit()

	resp := doJSONRaw(t, client, http.MethodGet, server.URL+"/api/v1/t/default/audit/"+id, nil)
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("detail: %d body=%s", resp.StatusCode, body)
	}
	var got map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&got)
	_ = resp.Body.Close()
	if got["actor"] != "alice" {
		t.Errorf("actor = %v", got["actor"])
	}
	if got["operation"] != "create" {
		t.Errorf("operation = %v", got["operation"])
	}
	if l, _ := got["_links"].(map[string]any); l["self"] == nil {
		t.Errorf("missing _links.self")
	}
}

func TestAuditExtra_Detail_NotFound(t *testing.T) {
	server, _, client := setupAuditExtraTestServer(t)
	resp := doJSONRaw(t, client, http.MethodGet, server.URL+"/api/v1/t/default/audit/no-such-id", nil)
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("expected 404, got %d", resp.StatusCode)
	}
}

func TestAuditExtra_ActorsAndResourceIDs(t *testing.T) {
	server, drv, client := setupAuditExtraTestServer(t)

	// Seed audit rows with distinct actors and entity ids.
	tx, _ := drv.Begin(context.Background(), store.TxOptions{})
	now := time.Now().UTC()
	for i, e := range []struct {
		actor, entType, entID string
	}{
		{"alice", "route", "r-1"},
		{"alice", "route", "r-2"},
		{"bob", "service", "s-1"},
	} {
		_ = tx.AppendAuditEntry(context.Background(), &riokuv1.AuditEntry{
			Actor:      e.actor,
			EntityType: e.entType,
			EntityId:   e.entID,
			Operation:  "create",
			OccurredAt: timestamppb.New(now.Add(time.Duration(i) * time.Second)),
		})
	}
	_ = tx.Commit()

	// Actors typeahead
	resp := doJSONRaw(t, client, http.MethodGet, server.URL+"/api/v1/t/default/audit/actors", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("actors: %d", resp.StatusCode)
	}
	var actorsBody map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&actorsBody)
	_ = resp.Body.Close()
	items, _ := actorsBody["items"].([]any)
	found := map[string]bool{}
	for _, it := range items {
		found[it.(string)] = true
	}
	if !found["alice"] || !found["bob"] {
		t.Errorf("actors missing alice/bob: %v", found)
	}

	// Actors filtered by prefix
	resp = doJSONRaw(t, client, http.MethodGet, server.URL+"/api/v1/t/default/audit/actors?q=al", nil)
	_ = json.NewDecoder(resp.Body).Decode(&actorsBody)
	_ = resp.Body.Close()
	items, _ = actorsBody["items"].([]any)
	if len(items) == 0 || items[0] != "alice" {
		t.Errorf("prefix typeahead: %v", items)
	}

	// Resource-ids filtered by entity_type
	resp = doJSONRaw(t, client, http.MethodGet, server.URL+"/api/v1/t/default/audit/resource-ids?entity_type=route", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("resource-ids: %d", resp.StatusCode)
	}
	var idsBody map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&idsBody)
	_ = resp.Body.Close()
	items, _ = idsBody["items"].([]any)
	if len(items) != 2 {
		t.Errorf("expected 2 route ids, got %d (%v)", len(items), items)
	}
}

func TestAuditExtra_ExportCSVAndJSONL(t *testing.T) {
	server, drv, client := setupAuditExtraTestServer(t)

	tx, _ := drv.Begin(context.Background(), store.TxOptions{})
	_ = tx.AppendAuditEntry(context.Background(), &riokuv1.AuditEntry{
		Actor:      "alice",
		EntityType: "route",
		EntityId:   "r-1",
		Operation:  "create",
		Diff:       `{"x":"y"}`,
		OccurredAt: timestamppb.New(time.Now().UTC()),
	})
	_ = tx.Commit()

	// CSV
	resp := doJSONRaw(t, client, http.MethodGet, server.URL+"/api/v1/t/default/audit/export/csv", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("csv: %d", resp.StatusCode)
	}
	csvBody, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if !strings.Contains(string(csvBody), "id,occurredAt,actor,entityType,entityId,operation,configVersion,diff") {
		t.Errorf("csv missing header: %s", csvBody)
	}
	if !strings.Contains(string(csvBody), "alice") {
		t.Errorf("csv missing row: %s", csvBody)
	}
	if got := resp.Header.Get("Content-Type"); !strings.HasPrefix(got, "text/csv") {
		t.Errorf("Content-Type = %q", got)
	}

	// JSONL
	resp = doJSONRaw(t, client, http.MethodGet, server.URL+"/api/v1/t/default/audit/export/jsonl", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("jsonl: %d", resp.StatusCode)
	}
	jsonlBody, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if !strings.Contains(string(jsonlBody), `"actor":"alice"`) {
		t.Errorf("jsonl missing alice: %s", jsonlBody)
	}
	if got := resp.Header.Get("Content-Type"); !strings.HasPrefix(got, "application/x-ndjson") {
		t.Errorf("Content-Type = %q", got)
	}
}

// TestAuditExtra_Reveal verifies the reveal endpoint records a new
// follow-up audit row carrying the supplied reason and returns the
// original entry in the response.
func TestAuditExtra_Reveal(t *testing.T) {
	server, drv, client := setupAuditExtraTestServer(t)

	id := "audit-reveal-1"
	tx, _ := drv.Begin(context.Background(), store.TxOptions{})
	_ = tx.AppendAuditEntry(context.Background(), &riokuv1.AuditEntry{
		Id:         id,
		Actor:      "alice",
		EntityType: "service",
		EntityId:   "svc-1",
		Operation:  "create",
		OccurredAt: timestamppb.New(time.Now().UTC()),
	})
	_ = tx.Commit()

	// reason too short -> 400
	resp := doJSONRaw(t, client, http.MethodPost,
		server.URL+"/api/v1/t/default/audit/"+id+"/reveal",
		map[string]any{"reason": "hi"})
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("short reason: expected 422, got %d", resp.StatusCode)
	}
	_ = resp.Body.Close()

	// happy path
	resp = doJSONRaw(t, client, http.MethodPost,
		server.URL+"/api/v1/t/default/audit/"+id+"/reveal",
		map[string]any{"reason": "Investigating incident #1234"})
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("reveal: %d body=%s", resp.StatusCode, body)
	}
	var got map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&got)
	_ = resp.Body.Close()
	entry, _ := got["entry"].(map[string]any)
	if entry["id"] != id {
		t.Errorf("entry.id = %v, want %s", entry["id"], id)
	}
	revealEntry, _ := got["revealEntry"].(map[string]any)
	if revealEntry["operation"] != "reveal" {
		t.Errorf("revealEntry.operation = %v, want reveal", revealEntry["operation"])
	}
	if revealEntry["entityId"] != id {
		t.Errorf("revealEntry.entityId = %v, want %s", revealEntry["entityId"], id)
	}

	// the new follow-up row should be persisted with the typed
	// audit.sensitive_revealed.v1 schema
	tx2, _ := drv.Begin(context.Background(), store.TxOptions{ReadOnly: true})
	defer func() { _ = tx2.Rollback() }()
	rows, err := tx2.QueryAuditLog(context.Background(), store.AuditQuery{
		EntityType: "audit-entry",
		EntityID:   id,
	})
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if len(rows) == 0 {
		t.Fatalf("no follow-up reveal row persisted")
	}
	if got := rows[0].GetPayloadSchema(); got != "audit.sensitive_revealed.v1" {
		t.Errorf("payloadSchema = %q, want audit.sensitive_revealed.v1", got)
	}
	if !strings.Contains(rows[0].GetPayload(), "Investigating incident") {
		t.Errorf("payload missing reason: %s", rows[0].GetPayload())
	}
}

// TestAuditExtra_Reveal_Forbidden verifies a session that lacks the
// `audit:read-sensitive` permission is denied on the reveal endpoint
// with a 403 + RFC-7807 problem-detail body. The viewer role (seeded
// by migration 000003) carries `audit:read` but NOT `audit:read-sensitive`,
// so it is the natural negative-case identity.
func TestAuditExtra_Reveal_Forbidden(t *testing.T) {
	server, drv, _ := setupAuditExtraTestServer(t)

	ctx := context.Background()

	// Seed the audit row first so the handler doesn't bail with 404 — the
	// permission check runs before the lookup but we still want the row
	// present so the test fails for the right reason if the gate is ever
	// regressed open.
	id := "audit-forbidden-1"
	tx, err := drv.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.AppendAuditEntry(ctx, &riokuv1.AuditEntry{
		Id:         id,
		Actor:      "alice",
		EntityType: "service",
		EntityId:   "svc-forbidden",
		Operation:  "create",
		OccurredAt: timestamppb.New(time.Now().UTC()),
	}); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}

	// Create a viewer-roled user and assign the seeded `role_viewer` role
	// (audit:read but no audit:read-sensitive).
	viewerPassword := "ViewerPassword123!"
	viewerHash := cachedHashPassword(t, viewerPassword)
	viewerUser, err := tx.CreateUser(ctx, &store.User{
		Username:            "viewer-bob",
		PasswordHash:        viewerHash,
		Status:              "active",
		ForcePasswordChange: false,
		PasswordChangedAt:   time.Now().UTC(),
	})
	if err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	roles, err := tx.ListRoles(ctx)
	if err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	var viewerRoleID string
	for _, role := range roles {
		if role.Name == "viewer" {
			viewerRoleID = role.ID
			break
		}
	}
	if viewerRoleID == "" {
		_ = tx.Rollback()
		t.Fatal("viewer role not found after migration")
	}
	if err := tx.AssignRole(ctx, viewerUser.ID, viewerRoleID, ""); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}

	// Login as the viewer with a fresh cookie jar so we don't inherit
	// the root session from `setupAuditExtraTestServer`.
	jar, _ := cookiejar.New(nil)
	viewerClient := &http.Client{Jar: jar}
	loginResp := doJSON(t, viewerClient, http.MethodPost, server.URL+"/api/v1/auth/login", map[string]string{
		"username": "viewer-bob",
		"password": viewerPassword,
	})
	_ = loginResp.Body.Close()
	if loginResp.StatusCode != http.StatusOK {
		t.Fatalf("viewer login failed: %d", loginResp.StatusCode)
	}

	// Reveal must return 403 with a problem-detail body identifying the
	// missing permission.
	resp := doJSONRaw(t, viewerClient, http.MethodPost,
		server.URL+"/api/v1/t/default/audit/"+id+"/reveal",
		map[string]any{"reason": "Probing the gate, not authorised"})
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusForbidden {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 403, got %d body=%s", resp.StatusCode, body)
	}

	if got := resp.Header.Get("Content-Type"); !strings.Contains(got, "problem+json") {
		t.Errorf("Content-Type = %q, want problem+json", got)
	}

	var problem map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&problem); err != nil {
		t.Fatalf("decode problem: %v", err)
	}
	if got, _ := problem["status"].(float64); got != http.StatusForbidden {
		t.Errorf("problem.status = %v, want 403", problem["status"])
	}
	if got, _ := problem["detail"].(string); !strings.Contains(got, "audit:read-sensitive") {
		t.Errorf("problem.detail missing required permission: %v", problem["detail"])
	}

	// And no follow-up reveal row was persisted — the gate must run
	// before the side-effect.
	rtx, err := drv.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = rtx.Rollback() }()
	rows, err := rtx.QueryAuditLog(ctx, store.AuditQuery{
		EntityType: "audit-entry",
		EntityID:   id,
	})
	if err != nil {
		t.Fatalf("query audit rows: %v", err)
	}
	if len(rows) != 0 {
		t.Errorf("expected no follow-up reveal rows, got %d", len(rows))
	}
}

func TestAuditExtra_OPTIONSCoverage(t *testing.T) {
	_, drv, _ := setupAuditExtraTestServer(t)

	mux := http.NewServeMux()
	RegisterAuditExtraRoutes(mux, drv)

	cases := []struct {
		path    string
		methods string
	}{
		{"/api/v1/t/default/audit/abc", "GET, OPTIONS"},
		{"/api/v1/t/default/audit/abc/reveal", "OPTIONS, POST"},
		{"/api/v1/t/default/audit/stream", "GET, OPTIONS"},
		{"/api/v1/t/default/audit/export/csv", "GET, OPTIONS"},
		{"/api/v1/t/default/audit/export/jsonl", "GET, OPTIONS"},
		{"/api/v1/t/default/audit/actors", "GET, OPTIONS"},
		{"/api/v1/t/default/audit/resource-ids", "GET, OPTIONS"},
	}
	for _, c := range cases {
		req := httptest.NewRequest(http.MethodOptions, c.path, nil)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusNoContent {
			t.Errorf("%s: expected 204, got %d", c.path, rec.Code)
		}
		if got := rec.Header().Get("Allow"); got != c.methods {
			t.Errorf("%s: Allow = %q, want %q", c.path, got, c.methods)
		}
	}
}
