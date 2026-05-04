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
)

// setupAccessPolicyTestServer mirrors setupSettingsTestServer but registers
// the access-policy routes too and returns an authenticated client.
func setupAccessPolicyTestServer(t *testing.T) (*httptest.Server, store.Driver, *http.Client) {
	t.Helper()
	ctx := context.Background()

	drv, err := store.New("sqlite")
	if err != nil {
		t.Fatal(err)
	}
	if err := drv.Open(ctx, store.DriverConfig{Path: filepath.Join(t.TempDir(), "ap.db")}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = drv.Close() })
	if err := drv.Migrate(ctx, store.MigrateUp); err != nil {
		t.Fatal(err)
	}

	rootPassword := "TestPassword123!"
	hash := cachedHashPassword(t, rootPassword)
	tx, _ := drv.Begin(ctx, store.TxOptions{})
	rootUser, err := tx.CreateUser(ctx, &store.User{
		Username: "root", PasswordHash: hash, Status: "active",
		ForcePasswordChange: false, PasswordChangedAt: time.Now().UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}
	roles, _ := tx.ListRoles(ctx)
	var superID string
	for _, r := range roles {
		if r.Name == "superadmin" {
			superID = r.ID
		}
	}
	if err := tx.AssignRole(ctx, rootUser.ID, superID, ""); err != nil {
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

	encKey, _ := auth.DeriveEncryptionKey(signingKey, []byte("rioku-totp-encryption-salt-v1"))
	enc, _ := auth.NewEncryptor(encKey)

	mux := http.NewServeMux()
	RegisterAuthRoutes(mux, a, sm, drv, cfg, enc)
	RegisterAccessPolicyRoutes(mux, drv)

	var handler http.Handler = mux
	handler = SecurityHeadersMiddleware(handler)
	handler = CORSMiddleware(cfg.Auth.CORS)(handler)
	rl := NewRateLimiter(cfg.Auth.RateLimit)
	t.Cleanup(rl.Stop)
	handler = rl.Middleware()(handler)
	handler = AuthMiddleware(a, sm)(handler)
	handler = RequestIDMiddleware(handler)

	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}
	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/login",
		map[string]string{"username": "root", "password": rootPassword})
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("login: %d", resp.StatusCode)
	}
	return server, drv, client
}

func TestAccessPolicy_CreateAndGet(t *testing.T) {
	server, _, client := setupAccessPolicyTestServer(t)

	body := map[string]any{
		"name":        "deny-after-hours",
		"description": "Block writes outside business hours",
		"effect":      "deny",
		"targetType":  "roles",
		"targetIds":   []string{"role_engineer"},
		"conditions": []any{
			map[string]any{"type": "time", "config": map[string]any{"start": "18:00", "end": "08:00"}},
		},
		"priority": 50,
		"enabled":  true,
	}
	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/access-policies", body)
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201, got %d", resp.StatusCode)
	}
	var created accessPolicyDTO
	if err := json.NewDecoder(resp.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}
	if created.ID == "" || created.Name != "deny-after-hours" {
		t.Errorf("create returned wrong policy: %+v", created)
	}
	if created.Effect != "deny" || created.Priority != 50 || !created.Enabled {
		t.Errorf("create round-trip mismatch: %+v", created)
	}
	if len(created.TargetIDs) != 1 || created.TargetIDs[0] != "role_engineer" {
		t.Errorf("targetIds round-trip failed: %v", created.TargetIDs)
	}
	if len(created.Conditions) != 1 || created.Conditions[0].Type != "time" {
		t.Errorf("conditions round-trip failed: %v", created.Conditions)
	}

	// Get
	resp2 := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/auth/access-policies/"+created.ID, nil)
	defer func() { _ = resp2.Body.Close() }()
	if resp2.StatusCode != http.StatusOK {
		t.Fatalf("get: %d", resp2.StatusCode)
	}
}

func TestAccessPolicy_List(t *testing.T) {
	server, _, client := setupAccessPolicyTestServer(t)

	for _, name := range []string{"alpha", "bravo", "charlie"} {
		_ = doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/access-policies",
			map[string]any{
				"name": name, "effect": "allow", "targetType": "all",
			})
	}
	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/auth/access-policies", nil)
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("list: %d", resp.StatusCode)
	}
	var body struct {
		Items []accessPolicyDTO `json:"items"`
		Total int               `json:"total"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Total != 3 || len(body.Items) != 3 {
		t.Errorf("expected 3 items, got total=%d len=%d", body.Total, len(body.Items))
	}
}

func TestAccessPolicy_UpdatePartial(t *testing.T) {
	server, _, client := setupAccessPolicyTestServer(t)

	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/access-policies",
		map[string]any{"name": "to-update", "effect": "allow", "targetType": "all", "priority": 100})
	defer func() { _ = resp.Body.Close() }()
	var created accessPolicyDTO
	_ = json.NewDecoder(resp.Body).Decode(&created)

	patchBody := map[string]any{
		"description": "now disabled",
		"enabled":     false,
		"priority":    25,
	}
	resp2 := doJSON(t, client, http.MethodPut, server.URL+"/api/v1/auth/access-policies/"+created.ID, patchBody)
	defer func() { _ = resp2.Body.Close() }()
	if resp2.StatusCode != http.StatusOK {
		t.Fatalf("update: %d", resp2.StatusCode)
	}
	var updated accessPolicyDTO
	if err := json.NewDecoder(resp2.Body).Decode(&updated); err != nil {
		t.Fatal(err)
	}
	if updated.Description != "now disabled" || updated.Enabled || updated.Priority != 25 {
		t.Errorf("update did not stick: %+v", updated)
	}
	// Untouched fields preserved.
	if updated.Name != "to-update" || updated.Effect != "allow" {
		t.Errorf("untouched fields changed: %+v", updated)
	}
}

func TestAccessPolicy_Delete(t *testing.T) {
	server, _, client := setupAccessPolicyTestServer(t)

	resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/access-policies",
		map[string]any{"name": "doomed", "effect": "deny", "targetType": "all"})
	defer func() { _ = resp.Body.Close() }()
	var created accessPolicyDTO
	_ = json.NewDecoder(resp.Body).Decode(&created)

	resp2 := doJSON(t, client, http.MethodDelete, server.URL+"/api/v1/auth/access-policies/"+created.ID, nil)
	defer func() { _ = resp2.Body.Close() }()
	if resp2.StatusCode != http.StatusNoContent {
		t.Fatalf("delete: %d", resp2.StatusCode)
	}

	resp3 := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/auth/access-policies/"+created.ID, nil)
	defer func() { _ = resp3.Body.Close() }()
	if resp3.StatusCode != http.StatusNotFound {
		t.Errorf("expected 404 after delete, got %d", resp3.StatusCode)
	}
}

func TestAccessPolicy_DuplicateName(t *testing.T) {
	server, _, client := setupAccessPolicyTestServer(t)

	body := map[string]any{"name": "dup", "effect": "allow", "targetType": "all"}
	r1 := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/access-policies", body)
	defer func() { _ = r1.Body.Close() }()
	if r1.StatusCode != http.StatusCreated {
		t.Fatalf("first create: %d", r1.StatusCode)
	}
	r2 := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/access-policies", body)
	defer func() { _ = r2.Body.Close() }()
	if r2.StatusCode != http.StatusConflict {
		t.Errorf("expected 409, got %d", r2.StatusCode)
	}
}

func TestAccessPolicy_ValidationErrors(t *testing.T) {
	server, _, client := setupAccessPolicyTestServer(t)

	cases := []struct {
		name string
		body map[string]any
	}{
		{"missing name", map[string]any{"effect": "allow", "targetType": "all"}},
		{"bad effect", map[string]any{"name": "x", "effect": "maybe", "targetType": "all"}},
		{"bad target", map[string]any{"name": "x", "effect": "allow", "targetType": "anything"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			resp := doJSON(t, client, http.MethodPost, server.URL+"/api/v1/auth/access-policies", tc.body)
			defer func() { _ = resp.Body.Close() }()
			if resp.StatusCode != http.StatusBadRequest {
				t.Errorf("expected 400, got %d", resp.StatusCode)
			}
		})
	}
}

func TestAccessPolicy_NotFound(t *testing.T) {
	server, _, client := setupAccessPolicyTestServer(t)

	resp := doJSON(t, client, http.MethodGet, server.URL+"/api/v1/auth/access-policies/nope", nil)
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("expected 404, got %d", resp.StatusCode)
	}
}
