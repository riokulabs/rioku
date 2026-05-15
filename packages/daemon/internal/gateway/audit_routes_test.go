package gateway

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/config"
	"github.com/riokulabs/rioku/internal/store"
	_ "github.com/riokulabs/rioku/internal/store/sqlite"

	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// setupAuditTestServer creates a test server with auth, RBAC, and audit routes.
func setupAuditTestServer(t *testing.T) (*httptest.Server, store.Driver, string) {
	t.Helper()
	ctx := context.Background()

	drv, err := store.New("sqlite")
	if err != nil {
		t.Fatal(err)
	}

	dbPath := filepath.Join(t.TempDir(), "audit_test.db")
	if err := drv.Open(ctx, store.DriverConfig{Path: dbPath}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = drv.Close() })

	if err := drv.Migrate(ctx, store.MigrateUp); err != nil {
		t.Fatal(err)
	}

	rootPassword := "TestPassword123!"
	hash := cachedHashPassword(t, rootPassword)
	tx, err := drv.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatal(err)
	}
	rootUser, err := tx.CreateUser(ctx, &store.User{
		Username:            "root",
		PasswordHash:        hash,
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
	var superadminRoleID string
	for _, role := range roles {
		if role.Name == "superadmin" {
			superadminRoleID = role.ID
			break
		}
	}
	if superadminRoleID == "" {
		_ = tx.Rollback()
		t.Fatal("superadmin role not found after migration")
	}
	if err := tx.AssignRole(ctx, rootUser.ID, superadminRoleID, ""); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}

	signingKey := []byte("test-signing-key-32-bytes-long!!")
	a := auth.NewAuth(signingKey, drv)
	sm := auth.NewSessionManager(drv, true)

	cfg := config.Default()
	cfg.Auth.RateLimit.RequestsPerMinute = 1000

	encKey, err := auth.DeriveEncryptionKey(signingKey, []byte("rioku-totp-encryption-salt-v1"))
	if err != nil {
		t.Fatal(err)
	}
	enc, err := auth.NewEncryptor(encKey)
	if err != nil {
		t.Fatal(err)
	}

	mux := http.NewServeMux()
	RegisterAuthRoutes(mux, a, sm, drv, cfg, enc)
	RegisterRBACRoutes(mux, drv, nil)
	RegisterAuditRoutes(mux, drv)

	var handler http.Handler = mux
	handler = SecurityHeadersMiddleware(handler)
	rl := NewRateLimiter(cfg.Auth.RateLimit)
	t.Cleanup(rl.Stop)
	handler = rl.Middleware()(handler)
	handler = AuthMiddleware(a, sm)(handler)
	handler = RequestIDMiddleware(handler)

	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	return server, drv, rootPassword
}

// seedAuditEntries inserts audit entries directly into the store for testing.
func seedAuditEntries(t *testing.T, drv store.Driver, entries []*riokuv1.AuditEntry) {
	t.Helper()
	ctx := context.Background()
	tx, err := drv.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if err := tx.AppendAuditEntry(ctx, e); err != nil {
			_ = tx.Rollback()
			t.Fatal(err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
}

// ---------------------------------------------------------------------------
// handleAuditQuery
// ---------------------------------------------------------------------------

func TestAuditRoutes_ListAudit(t *testing.T) {
	server, drv, rootPassword := setupAuditTestServer(t)

	// Seed some audit entries.
	now := time.Now().UTC()
	seedAuditEntries(t, drv, []*riokuv1.AuditEntry{
		{
			Actor:         "admin",
			EntityType:    "route",
			EntityId:      "route-1",
			Operation:     "create",
			Diff:          `{"added":"upstream"}`,
			ConfigVersion: 1,
			OccurredAt:    timestamppb.New(now.Add(-time.Hour)),
		},
		{
			Actor:         "admin",
			EntityType:    "service",
			EntityId:      "svc-1",
			Operation:     "update",
			Diff:          `{"changed":"timeout"}`,
			ConfigVersion: 2,
			OccurredAt:    timestamppb.New(now),
		},
	})

	// Login and query.
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Jar: jar}

	loginResp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/login", map[string]string{
		"username": "root",
		"password": rootPassword,
	})
	defer func() { _ = loginResp.Body.Close() }()
	if loginResp.StatusCode != http.StatusOK {
		t.Fatalf("login: expected 200, got %d", loginResp.StatusCode)
	}

	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/audit?limit=10", nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	// Parse the JSON array. The response uses protojson so field names are camelCase.
	var entries []map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&entries); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(entries) < 2 {
		t.Fatalf("expected at least 2 entries, got %d", len(entries))
	}
}

func TestAuditRoutes_ListAudit_WithFilters(t *testing.T) {
	server, drv, rootPassword := setupAuditTestServer(t)

	now := time.Now().UTC()
	seedAuditEntries(t, drv, []*riokuv1.AuditEntry{
		{
			Actor:         "alice",
			EntityType:    "route",
			EntityId:      "route-100",
			Operation:     "create",
			ConfigVersion: 1,
			OccurredAt:    timestamppb.New(now),
		},
		{
			Actor:         "bob",
			EntityType:    "service",
			EntityId:      "svc-200",
			Operation:     "delete",
			ConfigVersion: 2,
			OccurredAt:    timestamppb.New(now),
		},
		{
			Actor:         "alice",
			EntityType:    "route",
			EntityId:      "route-101",
			Operation:     "update",
			ConfigVersion: 3,
			OccurredAt:    timestamppb.New(now),
		},
	})

	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Jar: jar}

	loginResp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/login", map[string]string{
		"username": "root",
		"password": rootPassword,
	})
	defer func() { _ = loginResp.Body.Close() }()
	if loginResp.StatusCode != http.StatusOK {
		t.Fatalf("login: expected 200, got %d", loginResp.StatusCode)
	}

	t.Run("filter_by_entity_type", func(t *testing.T) {
		resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/audit?entity_type=route&limit=100", nil)
		defer func() { _ = resp.Body.Close() }()

		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200, got %d", resp.StatusCode)
		}

		var entries []map[string]any
		if err := json.NewDecoder(resp.Body).Decode(&entries); err != nil {
			t.Fatalf("decode: %v", err)
		}
		for _, e := range entries {
			if e["entityType"] != "route" {
				t.Errorf("expected entityType=route, got %v", e["entityType"])
			}
		}
		if len(entries) < 2 {
			t.Errorf("expected at least 2 route entries, got %d", len(entries))
		}
	})

	t.Run("filter_by_actor", func(t *testing.T) {
		resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/audit?actor=bob&limit=100", nil)
		defer func() { _ = resp.Body.Close() }()

		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200, got %d", resp.StatusCode)
		}

		var entries []map[string]any
		if err := json.NewDecoder(resp.Body).Decode(&entries); err != nil {
			t.Fatalf("decode: %v", err)
		}
		for _, e := range entries {
			if e["actor"] != "bob" {
				t.Errorf("expected actor=bob, got %v", e["actor"])
			}
		}
		if len(entries) < 1 {
			t.Errorf("expected at least 1 bob entry, got %d", len(entries))
		}
	})

	t.Run("filter_by_entity_id", func(t *testing.T) {
		resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/audit?entity_id=svc-200&limit=100", nil)
		defer func() { _ = resp.Body.Close() }()

		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200, got %d", resp.StatusCode)
		}

		var entries []map[string]any
		if err := json.NewDecoder(resp.Body).Decode(&entries); err != nil {
			t.Fatalf("decode: %v", err)
		}
		for _, e := range entries {
			if e["entityId"] != "svc-200" {
				t.Errorf("expected entityId=svc-200, got %v", e["entityId"])
			}
		}
		if len(entries) < 1 {
			t.Errorf("expected at least 1 svc-200 entry, got %d", len(entries))
		}
	})
}

func TestAuditRoutes_ListAudit_RangeFilter(t *testing.T) {
	server, drv, rootPassword := setupAuditTestServer(t)

	now := time.Now().UTC()
	seedAuditEntries(t, drv, []*riokuv1.AuditEntry{
		{
			Actor:         "admin",
			EntityType:    "route",
			EntityId:      "r-old",
			Operation:     "create",
			ConfigVersion: 1,
			OccurredAt:    timestamppb.New(now.Add(-48 * time.Hour)),
		},
		{
			Actor:         "admin",
			EntityType:    "route",
			EntityId:      "r-recent",
			Operation:     "update",
			ConfigVersion: 2,
			OccurredAt:    timestamppb.New(now.Add(-1 * time.Hour)),
		},
	})

	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Jar: jar}

	loginResp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/login", map[string]string{
		"username": "root",
		"password": rootPassword,
	})
	defer func() { _ = loginResp.Body.Close() }()
	if loginResp.StatusCode != http.StatusOK {
		t.Fatalf("login: expected 200, got %d", loginResp.StatusCode)
	}

	// Only entries from the last 24h.
	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/audit?range=24h&limit=100", nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var entries []map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&entries); err != nil {
		t.Fatalf("decode: %v", err)
	}
	// The 48h-old entry should be excluded.
	for _, e := range entries {
		if e["entityId"] == "r-old" {
			t.Error("expected old entry to be excluded by range=24h filter")
		}
	}
}

func TestAuditRoutes_ListAudit_InvalidRange(t *testing.T) {
	server, _, rootPassword := setupAuditTestServer(t)

	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Jar: jar}

	loginResp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/login", map[string]string{
		"username": "root",
		"password": rootPassword,
	})
	defer func() { _ = loginResp.Body.Close() }()
	if loginResp.StatusCode != http.StatusOK {
		t.Fatalf("login: expected 200, got %d", loginResp.StatusCode)
	}

	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/audit?range=invalid", nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d", resp.StatusCode)
	}
}

func TestAuditRoutes_ListAudit_InvalidLimit(t *testing.T) {
	server, _, rootPassword := setupAuditTestServer(t)

	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Jar: jar}

	loginResp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/login", map[string]string{
		"username": "root",
		"password": rootPassword,
	})
	defer func() { _ = loginResp.Body.Close() }()
	if loginResp.StatusCode != http.StatusOK {
		t.Fatalf("login: expected 200, got %d", loginResp.StatusCode)
	}

	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/audit?limit=abc", nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d", resp.StatusCode)
	}
}

func TestAuditRoutes_ListAudit_InvalidOffset(t *testing.T) {
	server, _, rootPassword := setupAuditTestServer(t)

	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Jar: jar}

	loginResp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/login", map[string]string{
		"username": "root",
		"password": rootPassword,
	})
	defer func() { _ = loginResp.Body.Close() }()
	if loginResp.StatusCode != http.StatusOK {
		t.Fatalf("login: expected 200, got %d", loginResp.StatusCode)
	}

	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/audit?offset=-1", nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d", resp.StatusCode)
	}
}

// ---------------------------------------------------------------------------
// Per-entity routes + total-count header (#82)
// ---------------------------------------------------------------------------

func TestAuditRoutes_ListAudit_TotalCountHeader(t *testing.T) {
	server, drv, rootPassword := setupAuditTestServer(t)

	// Seed 5 entries; query with limit=2 should show 5 in X-Total-Count.
	now := time.Now().UTC()
	var entries []*riokuv1.AuditEntry
	for i := 0; i < 5; i++ {
		entries = append(entries, &riokuv1.AuditEntry{
			Actor:         "admin",
			EntityType:    "route",
			EntityId:      "route-x",
			Operation:     "update",
			ConfigVersion: int64(i + 1),
			OccurredAt:    timestamppb.New(now.Add(time.Duration(i) * time.Second)),
		})
	}
	seedAuditEntries(t, drv, entries)

	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}
	loginResp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/login", map[string]string{
		"username": "root",
		"password": rootPassword,
	})
	_ = loginResp.Body.Close()

	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/audit?limit=2", nil)
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	if got := resp.Header.Get("X-Total-Count"); got != "5" {
		t.Errorf("X-Total-Count = %q, want 5", got)
	}
	var body []map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&body)
	if len(body) != 2 {
		t.Errorf("expected 2 entries (limit=2), got %d", len(body))
	}
}

func TestAuditRoutes_PerEntityRoute(t *testing.T) {
	server, drv, rootPassword := setupAuditTestServer(t)

	now := time.Now().UTC()
	seedAuditEntries(t, drv, []*riokuv1.AuditEntry{
		{Actor: "admin", EntityType: "route", EntityId: "r1", Operation: "create", OccurredAt: timestamppb.New(now)},
		{Actor: "admin", EntityType: "route", EntityId: "r2", Operation: "create", OccurredAt: timestamppb.New(now)},
		{Actor: "admin", EntityType: "service", EntityId: "r1", Operation: "create", OccurredAt: timestamppb.New(now)},
	})

	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}
	_ = doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/login", map[string]string{
		"username": "root",
		"password": rootPassword,
	}).Body.Close()

	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/audit/entity/route/r1", nil)
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	var body []map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&body)
	if len(body) != 1 {
		t.Errorf("expected 1 entry for route/r1, got %d", len(body))
	}
	if len(body) > 0 {
		if body[0]["entityType"] != "route" || body[0]["entityId"] != "r1" {
			t.Errorf("wrong entity returned: %+v", body[0])
		}
	}
}

func TestAuditRoutes_PerEntityRoute_QueryConflictRejected(t *testing.T) {
	server, _, rootPassword := setupAuditTestServer(t)

	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}
	_ = doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/login", map[string]string{
		"username": "root",
		"password": rootPassword,
	}).Body.Close()

	// Path says route/r1 but query says service — must reject.
	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/audit/entity/route/r1?entity_type=service", nil)
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Errorf("expected 422 on path/query conflict, got %d", resp.StatusCode)
	}
}

func TestAuditRoutes_UntilParam(t *testing.T) {
	server, drv, rootPassword := setupAuditTestServer(t)

	now := time.Now().UTC()
	seedAuditEntries(t, drv, []*riokuv1.AuditEntry{
		{Actor: "admin", EntityType: "route", EntityId: "r1", Operation: "create", OccurredAt: timestamppb.New(now.Add(-2 * time.Hour))},
		{Actor: "admin", EntityType: "route", EntityId: "r2", Operation: "create", OccurredAt: timestamppb.New(now)},
	})

	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}
	_ = doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/login", map[string]string{
		"username": "root",
		"password": rootPassword,
	}).Body.Close()

	cutoff := now.Add(-1 * time.Hour).Format(time.RFC3339)
	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/audit?until="+cutoff, nil)
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	var body []map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&body)
	if len(body) != 1 {
		t.Errorf("expected 1 entry before cutoff, got %d", len(body))
	}
}

func TestAuditRoutes_UntilParam_InvalidRejected(t *testing.T) {
	server, _, rootPassword := setupAuditTestServer(t)

	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}
	_ = doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/login", map[string]string{
		"username": "root",
		"password": rootPassword,
	}).Body.Close()

	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/audit?until=not-a-timestamp", nil)
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Errorf("expected 422 for malformed until, got %d", resp.StatusCode)
	}
}

func TestAuditRoutes_RequiresPermission(t *testing.T) {
	server, _, _ := setupAuditTestServer(t)

	// No login — request should be rejected by the permission middleware.
	resp, err := http.Get(server.URL + "/api/v1/audit")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode == http.StatusOK {
		t.Errorf("expected non-200 for unauthenticated audit query, got %d", resp.StatusCode)
	}
}

// ---------------------------------------------------------------------------
// parseRange (unit tests)
// ---------------------------------------------------------------------------

func TestParseRange(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    time.Duration
		wantErr bool
	}{
		{name: "empty", input: "", want: 0},
		{name: "hours", input: "24h", want: 24 * time.Hour},
		{name: "days", input: "7d", want: 7 * 24 * time.Hour},
		{name: "one_hour", input: "1h", want: time.Hour},
		{name: "one_day", input: "1d", want: 24 * time.Hour},
		{name: "go_duration_minutes", input: "30m", want: 30 * time.Minute},
		{name: "go_duration_seconds", input: "90s", want: 90 * time.Second},
		{name: "invalid_suffix", input: "10x", wantErr: true},
		{name: "no_number", input: "h", wantErr: true},
		{name: "garbage", input: "abc", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseRange(tt.input)
			if (err != nil) != tt.wantErr {
				t.Fatalf("parseRange(%q) err = %v, wantErr %v", tt.input, err, tt.wantErr)
			}
			if !tt.wantErr && got != tt.want {
				t.Errorf("parseRange(%q) = %v, want %v", tt.input, got, tt.want)
			}
		})
	}
}
