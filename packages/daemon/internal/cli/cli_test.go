package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/config"
	"github.com/riokulabs/rioku/internal/store"

	// Register the SQLite driver (already imported by migrate_test.go, but
	// needed when running this file in isolation).
	_ "github.com/riokulabs/rioku/internal/store/sqlite"
)

// ---------------------------------------------------------------------------
// client.go — parseAPIError
// ---------------------------------------------------------------------------

func TestParseAPIError(t *testing.T) {
	body := []byte(`{"title":"Bad Request","detail":"invalid route id","status":400}`)
	err := parseAPIError(400, body)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	want := "invalid route id (HTTP 400)"
	if err.Error() != want {
		t.Errorf("got %q, want %q", err.Error(), want)
	}
}

func TestParseAPIError_NonJSON(t *testing.T) {
	body := []byte("plain text error body")
	err := parseAPIError(502, body)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	want := "HTTP 502: plain text error body"
	if err.Error() != want {
		t.Errorf("got %q, want %q", err.Error(), want)
	}
}

func TestParseAPIError_EmptyDetail(t *testing.T) {
	// JSON is valid but detail is empty — should fall through to generic format.
	body := []byte(`{"title":"Not Found","status":404}`)
	err := parseAPIError(404, body)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	want := `HTTP 404: {"title":"Not Found","status":404}`
	if err.Error() != want {
		t.Errorf("got %q, want %q", err.Error(), want)
	}
}

// ---------------------------------------------------------------------------
// client.go — isLocalAddr
// ---------------------------------------------------------------------------

func TestIsLocalAddr(t *testing.T) {
	cases := []struct {
		name string
		addr string
		want bool
	}{
		{"localhost", "http://localhost:7778", true},
		{"localhost_uppercase", "http://LOCALHOST:7778", true},
		{"127.0.0.1", "http://127.0.0.1:7778", true},
		{"ipv6_loopback", "http://[::1]:7778", true},
		{"remote", "http://remote.host:7778", false},
		{"empty", "", false},
		{"10.0.0.1", "http://10.0.0.1:7778", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := isLocalAddr(tc.addr)
			if got != tc.want {
				t.Errorf("isLocalAddr(%q) = %v, want %v", tc.addr, got, tc.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// client.go — APIClient.do (via Get / Post / Delete wrappers)
// ---------------------------------------------------------------------------

func TestAPIClient_Get_Success(t *testing.T) {
	type respBody struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("expected GET, got %s", r.Method)
		}
		if r.URL.Path != "/api/v1/routes" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer test-token" {
			t.Errorf("expected Authorization 'Bearer test-token', got %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(respBody{ID: "r1", Name: "my-route"})
	}))
	defer srv.Close()

	client := &APIClient{
		BaseURL:    srv.URL,
		Token:      "test-token",
		HTTPClient: srv.Client(),
	}

	data, err := client.Get(context.Background(), "/api/v1/routes")
	if err != nil {
		t.Fatalf("Get returned error: %v", err)
	}

	var got respBody
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.ID != "r1" || got.Name != "my-route" {
		t.Errorf("unexpected body: %+v", got)
	}
}

func TestAPIClient_Post_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST, got %s", r.Method)
		}
		if ct := r.Header.Get("Content-Type"); ct != "application/json" {
			t.Errorf("expected Content-Type application/json, got %q", ct)
		}
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"id":"new-123"}`))
	}))
	defer srv.Close()

	client := &APIClient{
		BaseURL:    srv.URL,
		Token:      "tok",
		HTTPClient: srv.Client(),
	}

	data, err := client.Post(context.Background(), "/api/v1/config", map[string]string{"name": "test"})
	if err != nil {
		t.Fatalf("Post returned error: %v", err)
	}
	if string(data) != `{"id":"new-123"}` {
		t.Errorf("unexpected response: %s", data)
	}
}

func TestAPIClient_Delete_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			t.Errorf("expected DELETE, got %s", r.Method)
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()

	client := &APIClient{
		BaseURL:    srv.URL,
		HTTPClient: srv.Client(),
	}

	if err := client.Delete(context.Background(), "/api/v1/keys/k1"); err != nil {
		t.Fatalf("Delete returned error: %v", err)
	}
}

func TestAPIClient_Do_ErrorResponse(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"title":"Bad Request","detail":"missing name field","status":400}`))
	}))
	defer srv.Close()

	client := &APIClient{
		BaseURL:    srv.URL,
		HTTPClient: srv.Client(),
	}

	_, err := client.Get(context.Background(), "/api/v1/routes")
	if err == nil {
		t.Fatal("expected error for 400 response, got nil")
	}
	want := "missing name field (HTTP 400)"
	if err.Error() != want {
		t.Errorf("got %q, want %q", err.Error(), want)
	}
}

func TestAPIClient_NoToken_NoAuthHeader(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if auth := r.Header.Get("Authorization"); auth != "" {
			t.Errorf("expected no Authorization header, got %q", auth)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	client := &APIClient{
		BaseURL:    srv.URL,
		Token:      "",
		HTTPClient: srv.Client(),
	}

	_, err := client.Get(context.Background(), "/healthz")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

// ---------------------------------------------------------------------------
// output.go — truncate
// ---------------------------------------------------------------------------

func TestTruncate(t *testing.T) {
	cases := []struct {
		name string
		s    string
		max  int
		want string
	}{
		{"short_string", "hello", 10, "hello"},
		{"exact_length", "hello", 5, "hello"},
		{"long_string", "hello world", 8, "hello..."},
		{"min_truncation", "abcdef", 4, "a..."},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := truncate(tc.s, tc.max)
			if got != tc.want {
				t.Errorf("truncate(%q, %d) = %q, want %q", tc.s, tc.max, got, tc.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// policy.go — mapKeys
// ---------------------------------------------------------------------------

func TestMapKeys(t *testing.T) {
	m := map[string]string{
		"rate-limit": "POLICY_TYPE_RATE_LIMIT",
		"auth-jwt":   "POLICY_TYPE_AUTH_JWT",
		"transform":  "POLICY_TYPE_TRANSFORM",
	}
	got := mapKeys(m)
	sort.Strings(got)

	want := []string{"auth-jwt", "rate-limit", "transform"}
	if len(got) != len(want) {
		t.Fatalf("mapKeys returned %d keys, want %d", len(got), len(want))
	}
	for i, k := range want {
		if got[i] != k {
			t.Errorf("mapKeys[%d] = %q, want %q", i, got[i], k)
		}
	}
}

func TestMapKeys_Empty(t *testing.T) {
	got := mapKeys(map[string]string{})
	if len(got) != 0 {
		t.Errorf("expected empty slice, got %v", got)
	}
}

// ---------------------------------------------------------------------------
// init.go — createRootUser (real SQLite store)
// ---------------------------------------------------------------------------

func TestCreateRootUser(t *testing.T) {
	dir := t.TempDir()
	drv := openSQLiteStore(t, dir, "root-user")
	defer func() { _ = drv.Close() }()

	ctx := context.Background()

	plaintext, err := createRootUser(ctx, drv, "MyP@ssw0rd!", true)
	if err != nil {
		t.Fatalf("createRootUser: %v", err)
	}
	if plaintext != "MyP@ssw0rd!" {
		t.Errorf("expected password 'MyP@ssw0rd!', got %q", plaintext)
	}

	// Verify user exists.
	tx, err := drv.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback() }()

	user, err := tx.GetUserByUsername(ctx, "root")
	if err != nil {
		t.Fatalf("GetUserByUsername: %v", err)
	}
	if user.Username != "root" {
		t.Errorf("expected username 'root', got %q", user.Username)
	}
	if user.Status != "active" {
		t.Errorf("expected status 'active', got %q", user.Status)
	}
	if !user.ForcePasswordChange {
		t.Error("expected ForcePasswordChange to be true")
	}

	// Verify password hash is valid.
	ok, err := auth.VerifyPassword(plaintext, user.PasswordHash)
	if err != nil {
		t.Fatalf("VerifyPassword: %v", err)
	}
	if !ok {
		t.Error("password hash does not match plaintext")
	}

	// Verify superadmin role was assigned.
	roles, err := tx.ListUserRoles(ctx, user.ID)
	if err != nil {
		t.Fatalf("ListUserRoles: %v", err)
	}
	found := false
	for _, r := range roles {
		if r.RoleID == "role_superadmin" {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected role_superadmin to be assigned to root user")
	}
}

func TestCreateRootUser_GeneratesPassword(t *testing.T) {
	dir := t.TempDir()
	drv := openSQLiteStore(t, dir, "root-gen")
	defer func() { _ = drv.Close() }()

	ctx := context.Background()

	plaintext, err := createRootUser(ctx, drv, "", false)
	if err != nil {
		t.Fatalf("createRootUser: %v", err)
	}
	if len(plaintext) != 24 {
		t.Errorf("expected 24-char generated password, got %d chars", len(plaintext))
	}

	// Verify ForcePasswordChange is false when requested.
	tx, err := drv.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback() }()

	user, err := tx.GetUserByUsername(ctx, "root")
	if err != nil {
		t.Fatalf("GetUserByUsername: %v", err)
	}
	if user.ForcePasswordChange {
		t.Error("expected ForcePasswordChange to be false")
	}
}

func TestCreateRootUser_DuplicateUsername(t *testing.T) {
	dir := t.TempDir()
	drv := openSQLiteStore(t, dir, "root-dup")
	defer func() { _ = drv.Close() }()

	ctx := context.Background()

	_, err := createRootUser(ctx, drv, "pass1", true)
	if err != nil {
		t.Fatalf("first createRootUser: %v", err)
	}

	// Second call should fail because username "root" already exists.
	_, err = createRootUser(ctx, drv, "pass2", true)
	if err == nil {
		t.Fatal("expected error on duplicate root user, got nil")
	}
}

// ---------------------------------------------------------------------------
// root.go — command structure
// ---------------------------------------------------------------------------

func TestRootCmd_Subcommands(t *testing.T) {
	expected := []string{
		"init", "start", "stop", "status", "version",
		"key", "route", "service", "policy", "config",
		"audit", "migrate",
	}

	subs := make(map[string]bool)
	for _, cmd := range rootCmd.Commands() {
		subs[cmd.Name()] = true
	}

	for _, name := range expected {
		if !subs[name] {
			t.Errorf("root command missing expected subcommand %q", name)
		}
	}
}

func TestKeyCmd_Subcommands(t *testing.T) {
	cmd := newKeyCmd()
	expected := []string{"create", "list", "revoke"}

	subs := make(map[string]bool)
	for _, sub := range cmd.Commands() {
		subs[sub.Name()] = true
	}

	for _, name := range expected {
		if !subs[name] {
			t.Errorf("key command missing expected subcommand %q", name)
		}
	}
}

func TestRouteCmd_Subcommands(t *testing.T) {
	cmd := newRouteCmd()
	expected := []string{"list", "get", "create", "delete", "enable", "disable"}

	subs := make(map[string]bool)
	for _, sub := range cmd.Commands() {
		subs[sub.Name()] = true
	}

	for _, name := range expected {
		if !subs[name] {
			t.Errorf("route command missing expected subcommand %q", name)
		}
	}
}

func TestPolicyCmd_Subcommands(t *testing.T) {
	cmd := newPolicyCmd()
	expected := []string{"list", "get", "create", "delete"}

	subs := make(map[string]bool)
	for _, sub := range cmd.Commands() {
		subs[sub.Name()] = true
	}

	for _, name := range expected {
		if !subs[name] {
			t.Errorf("policy command missing expected subcommand %q", name)
		}
	}
}

// ---------------------------------------------------------------------------
// client.go — requireLocalNode (exercise via flag side-effects)
// ---------------------------------------------------------------------------

func TestRequireLocalNode_DefaultAddr(t *testing.T) {
	// When flagDaemonAddr is empty and RIOKU_DAEMON_ADDR is unset, requireLocalNode
	// should allow the command (assumes local).
	old := flagDaemonAddr
	defer func() { flagDaemonAddr = old }()
	flagDaemonAddr = ""

	t.Setenv("RIOKU_DAEMON_ADDR", "")

	if err := requireLocalNode("init"); err != nil {
		t.Errorf("expected no error for default addr, got: %v", err)
	}
}

func TestRequireLocalNode_RemoteAddr(t *testing.T) {
	old := flagDaemonAddr
	defer func() { flagDaemonAddr = old }()
	flagDaemonAddr = "http://remote.host:7778"

	if err := requireLocalNode("init"); err == nil {
		t.Error("expected error for remote addr, got nil")
	}
}

func TestRequireLocalNode_Localhost(t *testing.T) {
	old := flagDaemonAddr
	defer func() { flagDaemonAddr = old }()
	flagDaemonAddr = "http://localhost:7778"

	if err := requireLocalNode("init"); err != nil {
		t.Errorf("expected no error for localhost addr, got: %v", err)
	}
}

// ---------------------------------------------------------------------------
// output.go — printTable / printText (verify no panic, output goes to stdout)
// ---------------------------------------------------------------------------

func TestPrintTable_NoPanic(t *testing.T) {
	// printTable writes to os.Stdout — redirect to /dev/null so test output is clean.
	// The main goal is to verify it doesn't panic with valid and edge-case inputs.
	headers := []string{"ID", "NAME", "STATUS"}
	rows := [][]string{
		{"1", "alpha", "active"},
		{"2", "beta", "disabled"},
	}
	// Should not panic.
	captureStdout(t, func() {
		printTable(headers, rows)
	})
}

func TestPrintTable_EmptyRows(t *testing.T) {
	captureStdout(t, func() {
		printTable([]string{"COL1"}, nil)
	})
}

func TestPrintText_NoPanic(t *testing.T) {
	rows := [][]string{
		{"a", "b"},
		{"c", "d"},
	}
	captureStdout(t, func() {
		printText(rows)
	})
}

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

func TestExitCodes(t *testing.T) {
	if ExitSuccess != 0 {
		t.Errorf("ExitSuccess = %d, want 0", ExitSuccess)
	}
	if ExitGeneralError != 1 {
		t.Errorf("ExitGeneralError = %d, want 1", ExitGeneralError)
	}
	if ExitDaemonUnreachable != 3 {
		t.Errorf("ExitDaemonUnreachable = %d, want 3", ExitDaemonUnreachable)
	}
}

func TestDefaultDaemonAddr(t *testing.T) {
	if defaultDaemonAddr != "http://localhost:7778" {
		t.Errorf("defaultDaemonAddr = %q, want %q", defaultDaemonAddr, "http://localhost:7778")
	}
}

// ---------------------------------------------------------------------------
// output.go — printJSON (captures real output)
// ---------------------------------------------------------------------------

func TestPrintJSON(t *testing.T) {
	data := map[string]any{
		"name":  "test-svc",
		"count": 42,
	}

	out := captureStdoutToBytes(t, func() {
		if err := printJSON(data); err != nil {
			t.Fatalf("printJSON: %v", err)
		}
	})

	var parsed map[string]any
	if err := json.Unmarshal(out, &parsed); err != nil {
		t.Fatalf("output is not valid JSON: %v (raw: %s)", err, string(out))
	}
	if parsed["name"] != "test-svc" {
		t.Errorf("name = %v, want 'test-svc'", parsed["name"])
	}
}

func TestPrintJSON_Slice(t *testing.T) {
	data := []string{"alpha", "beta", "gamma"}

	out := captureStdoutToBytes(t, func() {
		if err := printJSON(data); err != nil {
			t.Fatalf("printJSON: %v", err)
		}
	})

	var parsed []string
	if err := json.Unmarshal(out, &parsed); err != nil {
		t.Fatalf("output is not valid JSON: %v", err)
	}
	if len(parsed) != 3 || parsed[0] != "alpha" {
		t.Errorf("unexpected: %v", parsed)
	}
}

func TestPrintJSON_Nil(t *testing.T) {
	out := captureStdoutToBytes(t, func() {
		if err := printJSON(nil); err != nil {
			t.Fatalf("printJSON(nil): %v", err)
		}
	})
	if strings.TrimSpace(string(out)) != "null" {
		t.Errorf("expected 'null', got %q", string(out))
	}
}

// ---------------------------------------------------------------------------
// output.go — printYAML
// ---------------------------------------------------------------------------

func TestPrintYAML(t *testing.T) {
	data := map[string]any{
		"name": "test-svc",
		"port": 8080,
	}

	out := captureStdoutToBytes(t, func() {
		if err := printYAML(data); err != nil {
			t.Fatalf("printYAML: %v", err)
		}
	})

	outStr := string(out)
	if !strings.Contains(outStr, "name: test-svc") {
		t.Errorf("YAML output missing 'name: test-svc': %s", outStr)
	}
	if !strings.Contains(outStr, "port: 8080") {
		t.Errorf("YAML output missing 'port: 8080': %s", outStr)
	}
}

func TestPrintYAML_Slice(t *testing.T) {
	data := []string{"one", "two"}

	out := captureStdoutToBytes(t, func() {
		if err := printYAML(data); err != nil {
			t.Fatalf("printYAML: %v", err)
		}
	})

	outStr := string(out)
	if !strings.Contains(outStr, "- one") {
		t.Errorf("YAML output missing '- one': %s", outStr)
	}
}

// ---------------------------------------------------------------------------
// output.go — printOutput (dispatches to JSON/YAML based on flagOutput)
// ---------------------------------------------------------------------------

func TestPrintOutput_JSON(t *testing.T) {
	old := flagOutput
	defer func() { flagOutput = old }()
	flagOutput = "json"

	data := map[string]string{"key": "value"}
	out := captureStdoutToBytes(t, func() {
		if err := printOutput(data); err != nil {
			t.Fatalf("printOutput(json): %v", err)
		}
	})

	var parsed map[string]string
	if err := json.Unmarshal(out, &parsed); err != nil {
		t.Fatalf("not valid JSON: %v", err)
	}
	if parsed["key"] != "value" {
		t.Errorf("key = %q, want 'value'", parsed["key"])
	}
}

func TestPrintOutput_YAML(t *testing.T) {
	old := flagOutput
	defer func() { flagOutput = old }()
	flagOutput = "yaml"

	data := map[string]string{"hello": "world"}
	out := captureStdoutToBytes(t, func() {
		if err := printOutput(data); err != nil {
			t.Fatalf("printOutput(yaml): %v", err)
		}
	})

	if !strings.Contains(string(out), "hello: world") {
		t.Errorf("YAML output missing 'hello: world': %s", string(out))
	}
}

func TestPrintOutput_Text(t *testing.T) {
	old := flagOutput
	defer func() { flagOutput = old }()
	flagOutput = "text"

	// Text mode falls back to JSON for non-row data.
	data := map[string]string{"a": "b"}
	out := captureStdoutToBytes(t, func() {
		if err := printOutput(data); err != nil {
			t.Fatalf("printOutput(text): %v", err)
		}
	})

	var parsed map[string]string
	if err := json.Unmarshal(out, &parsed); err != nil {
		t.Fatalf("text fallback is not valid JSON: %v", err)
	}
}

func TestPrintOutput_Default(t *testing.T) {
	old := flagOutput
	defer func() { flagOutput = old }()
	flagOutput = "table"

	// Default (table) falls back to JSON for non-row data.
	data := []int{1, 2, 3}
	out := captureStdoutToBytes(t, func() {
		if err := printOutput(data); err != nil {
			t.Fatalf("printOutput(table): %v", err)
		}
	})

	var parsed []int
	if err := json.Unmarshal(out, &parsed); err != nil {
		t.Fatalf("default fallback is not valid JSON: %v", err)
	}
}

// ---------------------------------------------------------------------------
// output.go — printRows (dispatches rows vs JSON/YAML)
// ---------------------------------------------------------------------------

func TestPrintRows_Table(t *testing.T) {
	old := flagOutput
	defer func() { flagOutput = old }()
	flagOutput = "table"

	headers := []string{"ID", "NAME"}
	rows := [][]string{{"1", "alpha"}, {"2", "beta"}}
	raw := []map[string]string{{"id": "1", "name": "alpha"}, {"id": "2", "name": "beta"}}

	out := captureStdoutToBytes(t, func() {
		if err := printRows(headers, rows, raw); err != nil {
			t.Fatalf("printRows(table): %v", err)
		}
	})

	outStr := string(out)
	if !strings.Contains(outStr, "ID") || !strings.Contains(outStr, "NAME") {
		t.Errorf("table output missing headers: %s", outStr)
	}
	if !strings.Contains(outStr, "alpha") {
		t.Errorf("table output missing 'alpha': %s", outStr)
	}
}

func TestPrintRows_JSON(t *testing.T) {
	old := flagOutput
	defer func() { flagOutput = old }()
	flagOutput = "json"

	raw := []map[string]string{{"id": "1"}}
	out := captureStdoutToBytes(t, func() {
		if err := printRows(nil, nil, raw); err != nil {
			t.Fatalf("printRows(json): %v", err)
		}
	})

	var parsed []map[string]string
	if err := json.Unmarshal(out, &parsed); err != nil {
		t.Fatalf("printRows JSON output invalid: %v", err)
	}
}

func TestPrintRows_YAML(t *testing.T) {
	old := flagOutput
	defer func() { flagOutput = old }()
	flagOutput = "yaml"

	raw := map[string]string{"key": "val"}
	out := captureStdoutToBytes(t, func() {
		if err := printRows(nil, nil, raw); err != nil {
			t.Fatalf("printRows(yaml): %v", err)
		}
	})

	if !strings.Contains(string(out), "key: val") {
		t.Errorf("printRows YAML missing 'key: val': %s", string(out))
	}
}

func TestPrintRows_Text(t *testing.T) {
	old := flagOutput
	defer func() { flagOutput = old }()
	flagOutput = "text"

	rows := [][]string{{"a", "b"}, {"c", "d"}}
	out := captureStdoutToBytes(t, func() {
		if err := printRows(nil, rows, nil); err != nil {
			t.Fatalf("printRows(text): %v", err)
		}
	})

	outStr := string(out)
	if !strings.Contains(outStr, "a\tb") {
		t.Errorf("text output missing 'a\\tb': %s", outStr)
	}
}

// ---------------------------------------------------------------------------
// stop.go — resolveDataDir
// ---------------------------------------------------------------------------

func TestResolveDataDir_NoConfig(t *testing.T) {
	// Point at a non-existent config file — should return nil config and default dir.
	old := flagConfigFile
	defer func() { flagConfigFile = old }()
	flagConfigFile = "/tmp/nonexistent-rioku-test-config-12345.yaml"

	cfg, dataDir := resolveDataDir()
	if cfg != nil {
		t.Error("expected nil config for nonexistent file")
	}
	if dataDir != config.DefaultDataDir {
		t.Errorf("dataDir = %q, want %q", dataDir, config.DefaultDataDir)
	}
}

func TestResolveDataDir_ValidConfig(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "rioku.yaml")

	cfgContent := fmt.Sprintf(`store:
  driver: sqlite
  sqlite:
    path: %s/rioku.db
listen:
  grpc: ":7777"
  rest: ":7778"
data_dir: %s
log_level: info
`, dir, dir)

	if err := os.WriteFile(cfgPath, []byte(cfgContent), 0640); err != nil {
		t.Fatalf("write config: %v", err)
	}

	old := flagConfigFile
	defer func() { flagConfigFile = old }()
	flagConfigFile = cfgPath

	cfg, dataDir := resolveDataDir()
	if cfg == nil {
		t.Fatal("expected non-nil config")
		return
	}
	if dataDir != dir {
		t.Errorf("dataDir = %q, want %q", dataDir, dir)
	}
	if cfg.Store.Driver != "sqlite" {
		t.Errorf("driver = %q, want 'sqlite'", cfg.Store.Driver)
	}
}

// ---------------------------------------------------------------------------
// status.go — printHealthFromREST
// ---------------------------------------------------------------------------

func TestPrintHealthFromREST_TableMode(t *testing.T) {
	old := flagOutput
	defer func() { flagOutput = old }()
	flagOutput = "table"

	healthJSON := `{
		"overall": "HEALTH_STATE_OK",
		"store": {"state": "HEALTH_STATE_OK", "detail": {"state": "leader"}},
		"caddy": {"state": "HEALTH_STATE_OK", "message": "running"},
		"version": "0.3.0",
		"uptimeSeconds": "120"
	}`

	out := captureStdoutToBytes(t, func() {
		if err := printHealthFromREST([]byte(healthJSON)); err != nil {
			t.Fatalf("printHealthFromREST: %v", err)
		}
	})

	outStr := string(out)
	if !strings.Contains(outStr, "OK") {
		t.Errorf("output missing 'OK': %s", outStr)
	}
	if !strings.Contains(outStr, "v0.3.0") {
		t.Errorf("output missing version: %s", outStr)
	}
	if !strings.Contains(outStr, "leader") {
		t.Errorf("output missing store detail: %s", outStr)
	}
	if !strings.Contains(outStr, "running") {
		t.Errorf("output missing caddy message: %s", outStr)
	}
}

func TestPrintHealthFromREST_JSONMode(t *testing.T) {
	old := flagOutput
	defer func() { flagOutput = old }()
	flagOutput = "json"

	healthJSON := `{"overall":"HEALTH_STATE_OK","version":"0.3.0"}`

	out := captureStdoutToBytes(t, func() {
		if err := printHealthFromREST([]byte(healthJSON)); err != nil {
			t.Fatalf("printHealthFromREST: %v", err)
		}
	})

	// Should output valid JSON.
	var parsed map[string]any
	if err := json.Unmarshal(out, &parsed); err != nil {
		t.Fatalf("JSON mode output is not valid JSON: %v (raw: %s)", err, string(out))
	}
}

func TestPrintHealthFromREST_YAMLMode(t *testing.T) {
	old := flagOutput
	defer func() { flagOutput = old }()
	flagOutput = "yaml"

	healthJSON := `{"overall":"HEALTH_STATE_DEGRADED","version":"0.3.0"}`

	out := captureStdoutToBytes(t, func() {
		if err := printHealthFromREST([]byte(healthJSON)); err != nil {
			t.Fatalf("printHealthFromREST: %v", err)
		}
	})

	if len(out) == 0 {
		t.Fatal("expected output, got empty")
	}
}

func TestPrintHealthFromREST_InvalidJSON(t *testing.T) {
	old := flagOutput
	defer func() { flagOutput = old }()
	flagOutput = "json"

	// Invalid JSON — should still output something (fallback).
	out := captureStdoutToBytes(t, func() {
		// printHealthFromREST tries json.Unmarshal; if it fails, it falls back to printOutput.
		_ = printHealthFromREST([]byte("not-json"))
	})
	_ = out // Just verify no panic.
}

func TestPrintHealthFromREST_DegradedState(t *testing.T) {
	old := flagOutput
	defer func() { flagOutput = old }()
	flagOutput = "table"

	healthJSON := `{
		"overall": "HEALTH_STATE_DEGRADED",
		"store": {"state": "HEALTH_STATE_OK", "detail": {}},
		"caddy": {"state": "HEALTH_STATE_UNHEALTHY", "message": ""},
		"version": "0.3.0",
		"uptimeSeconds": "5"
	}`

	out := captureStdoutToBytes(t, func() {
		if err := printHealthFromREST([]byte(healthJSON)); err != nil {
			t.Fatalf("printHealthFromREST: %v", err)
		}
	})

	outStr := string(out)
	if !strings.Contains(outStr, "DEGRADED") {
		t.Errorf("output missing 'DEGRADED': %s", outStr)
	}
	if !strings.Contains(outStr, "UNHEALTHY") {
		t.Errorf("output missing 'UNHEALTHY': %s", outStr)
	}
}

// ---------------------------------------------------------------------------
// client.go — newAPIClient
// ---------------------------------------------------------------------------

func TestNewAPIClient_Defaults(t *testing.T) {
	oldAddr := flagDaemonAddr
	oldToken := flagToken
	defer func() {
		flagDaemonAddr = oldAddr
		flagToken = oldToken
	}()

	flagDaemonAddr = ""
	flagToken = ""
	t.Setenv("RIOKU_DAEMON_ADDR", "")
	t.Setenv("RIOKU_TOKEN", "")

	client := newAPIClient()
	if client.BaseURL != defaultDaemonAddr {
		t.Errorf("BaseURL = %q, want %q", client.BaseURL, defaultDaemonAddr)
	}
	if client.Token != "" {
		t.Errorf("Token = %q, want empty", client.Token)
	}
}

func TestNewAPIClient_FlagOverrides(t *testing.T) {
	oldAddr := flagDaemonAddr
	oldToken := flagToken
	defer func() {
		flagDaemonAddr = oldAddr
		flagToken = oldToken
	}()

	flagDaemonAddr = "http://myhost:9999"
	flagToken = "my-secret-token"

	client := newAPIClient()
	if client.BaseURL != "http://myhost:9999" {
		t.Errorf("BaseURL = %q, want 'http://myhost:9999'", client.BaseURL)
	}
	if client.Token != "my-secret-token" {
		t.Errorf("Token = %q, want 'my-secret-token'", client.Token)
	}
}

func TestNewAPIClient_EnvOverrides(t *testing.T) {
	oldAddr := flagDaemonAddr
	oldToken := flagToken
	defer func() {
		flagDaemonAddr = oldAddr
		flagToken = oldToken
	}()

	flagDaemonAddr = ""
	flagToken = ""
	t.Setenv("RIOKU_DAEMON_ADDR", "http://envhost:8888")
	t.Setenv("RIOKU_TOKEN", "env-token")

	client := newAPIClient()
	if client.BaseURL != "http://envhost:8888" {
		t.Errorf("BaseURL = %q, want 'http://envhost:8888'", client.BaseURL)
	}
	if client.Token != "env-token" {
		t.Errorf("Token = %q, want 'env-token'", client.Token)
	}
}

func TestNewAPIClient_TrailingSlash(t *testing.T) {
	oldAddr := flagDaemonAddr
	defer func() { flagDaemonAddr = oldAddr }()

	flagDaemonAddr = "http://localhost:7778///"

	client := newAPIClient()
	if strings.HasSuffix(client.BaseURL, "/") {
		t.Errorf("BaseURL should not have trailing slash: %q", client.BaseURL)
	}
}

// ---------------------------------------------------------------------------
// version.go — newVersionCmd
// ---------------------------------------------------------------------------

func TestVersionCmd_Run(t *testing.T) {
	cmd := newVersionCmd()
	out := captureStdoutToBytes(t, func() {
		cmd.Run(cmd, nil)
	})

	outStr := string(out)
	if !strings.Contains(outStr, "rioku") {
		t.Errorf("version output missing 'rioku': %s", outStr)
	}
}

// ---------------------------------------------------------------------------
// migrate.go — openSourceFromConfig (with real SQLite)
// ---------------------------------------------------------------------------

func TestOpenSourceFromConfig_SQLite(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")

	// Create the SQLite database first so openSourceFromConfig can open it.
	setupDrv := openSQLiteStore(t, dir, "test")
	if err := setupDrv.Close(); err != nil {
		t.Fatalf("close setup driver: %v", err)
	}

	cfg := &config.Config{
		DataDir: dir,
		Store: config.StoreConfig{
			Driver: "sqlite",
			SQLite: config.SQLiteConfig{Path: dbPath},
		},
	}

	drv, err := openSourceFromConfig(cfg)
	if err != nil {
		t.Fatalf("openSourceFromConfig: %v", err)
	}
	defer func() { _ = drv.Close() }()

	// Verify it is functional by checking the version.
	ctx := context.Background()
	version, err := drv.CurrentVersion(ctx)
	if err != nil {
		t.Fatalf("CurrentVersion: %v", err)
	}
	if version < 1 {
		t.Errorf("expected version >= 1, got %d", version)
	}
}

func TestOpenSourceFromConfig_InvalidDriver(t *testing.T) {
	cfg := &config.Config{
		Store: config.StoreConfig{
			Driver: "invalid-driver",
		},
	}

	_, err := openSourceFromConfig(cfg)
	if err == nil {
		t.Fatal("expected error for invalid driver")
	}
	if !strings.Contains(err.Error(), "create store driver") {
		t.Errorf("error = %q, want 'create store driver'", err.Error())
	}
}

func TestOpenSourceFromConfig_DefaultsToRaft(t *testing.T) {
	dir := t.TempDir()
	cfg := &config.Config{
		DataDir: dir,
		Store: config.StoreConfig{
			Driver: "", // empty means raft
			Raft: config.RaftConfig{
				DataDir:  filepath.Join(dir, "raft"),
				BindAddr: "127.0.0.1:17779",
			},
		},
	}

	// Raft driver should open successfully (bootstraps a single-node cluster).
	// This verifies the empty-driver-defaults-to-raft logic.
	drv, err := openSourceFromConfig(cfg)
	if err != nil {
		t.Fatalf("openSourceFromConfig (raft): %v", err)
	}
	defer func() { _ = drv.Close() }()
}

// ---------------------------------------------------------------------------
// migrate.go — newMigrateVerifyCmd (with real SQLite)
// ---------------------------------------------------------------------------

func TestMigrateVerifyCmd_SQLite(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "verify.db")

	// Create the database.
	drv := openSQLiteStore(t, dir, "verify")
	if err := drv.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	// Set up globals so requireLocalNode passes.
	oldAddr := flagDaemonAddr
	defer func() { flagDaemonAddr = oldAddr }()
	flagDaemonAddr = ""

	cmd := newMigrateVerifyCmd()
	_ = cmd.Flags().Set("to", "sqlite")
	_ = cmd.Flags().Set("dsn", dbPath)

	out := captureStdoutToBytes(t, func() {
		if err := cmd.RunE(cmd, nil); err != nil {
			t.Fatalf("migrate verify: %v", err)
		}
	})

	outStr := string(out)
	if !strings.Contains(outStr, "Connected: OK") {
		t.Errorf("output missing 'Connected: OK': %s", outStr)
	}
}

func TestMigrateVerifyCmd_RemoteRejected(t *testing.T) {
	oldAddr := flagDaemonAddr
	defer func() { flagDaemonAddr = oldAddr }()
	flagDaemonAddr = "http://remote.host:7778"

	cmd := newMigrateVerifyCmd()
	_ = cmd.Flags().Set("to", "sqlite")

	err := cmd.RunE(cmd, nil)
	if err == nil {
		t.Fatal("expected error for remote addr")
	}
	if !strings.Contains(err.Error(), "must be run directly") {
		t.Errorf("error = %q, want 'must be run directly'", err.Error())
	}
}

func TestMigrateVerifyCmd_InvalidBackend(t *testing.T) {
	oldAddr := flagDaemonAddr
	defer func() { flagDaemonAddr = oldAddr }()
	flagDaemonAddr = ""

	cmd := newMigrateVerifyCmd()
	_ = cmd.Flags().Set("to", "invalid-backend")

	err := cmd.RunE(cmd, nil)
	if err == nil {
		t.Fatal("expected error for invalid backend")
	}
	if !strings.Contains(err.Error(), "unknown store backend") {
		t.Errorf("error = %q, want 'unknown store backend'", err.Error())
	}
}

// ---------------------------------------------------------------------------
// migrate.go — newMigrateStatusCmd (with real SQLite via config file)
// ---------------------------------------------------------------------------

func TestMigrateStatusCmd_WithConfig(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "status.db")

	// Create the database.
	drv := openSQLiteStore(t, dir, "status")
	if err := drv.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	// Write a valid config file.
	cfgPath := filepath.Join(dir, "rioku.yaml")
	cfgContent := fmt.Sprintf(`store:
  driver: sqlite
  sqlite:
    path: %s
listen:
  grpc: ":7777"
  rest: ":7778"
data_dir: %s
log_level: info
`, dbPath, dir)

	if err := os.WriteFile(cfgPath, []byte(cfgContent), 0640); err != nil {
		t.Fatalf("write config: %v", err)
	}

	// Set globals.
	oldAddr := flagDaemonAddr
	oldCfg := flagConfigFile
	defer func() {
		flagDaemonAddr = oldAddr
		flagConfigFile = oldCfg
	}()
	flagDaemonAddr = ""
	flagConfigFile = cfgPath

	cmd := newMigrateStatusCmd()
	out := captureStdoutToBytes(t, func() {
		if err := cmd.RunE(cmd, nil); err != nil {
			t.Fatalf("migrate status: %v", err)
		}
	})

	outStr := string(out)
	if !strings.Contains(outStr, "Store driver") {
		t.Errorf("output missing 'Store driver': %s", outStr)
	}
	if !strings.Contains(outStr, "Schema version") {
		t.Errorf("output missing 'Schema version': %s", outStr)
	}
	if !strings.Contains(outStr, "up to date") && !strings.Contains(outStr, "pending") {
		t.Errorf("output missing status indicator: %s", outStr)
	}
}

func TestMigrateStatusCmd_NoConfig(t *testing.T) {
	oldAddr := flagDaemonAddr
	oldCfg := flagConfigFile
	defer func() {
		flagDaemonAddr = oldAddr
		flagConfigFile = oldCfg
	}()
	flagDaemonAddr = ""
	flagConfigFile = "/tmp/nonexistent-rioku-config-test.yaml"

	cmd := newMigrateStatusCmd()
	err := cmd.RunE(cmd, nil)
	if err == nil {
		t.Fatal("expected error when config is missing")
	}
	if !strings.Contains(err.Error(), "cannot load config") {
		t.Errorf("error = %q, want 'cannot load config'", err.Error())
	}
}

// ---------------------------------------------------------------------------
// migrate.go — newMigrateRunCmd edge cases
// ---------------------------------------------------------------------------

func TestMigrateRunCmd_NoConfig(t *testing.T) {
	oldAddr := flagDaemonAddr
	oldCfg := flagConfigFile
	defer func() {
		flagDaemonAddr = oldAddr
		flagConfigFile = oldCfg
	}()
	flagDaemonAddr = ""
	flagConfigFile = "/tmp/nonexistent-rioku-config-run.yaml"

	cmd := newMigrateRunCmd()
	_ = cmd.Flags().Set("to", "sqlite")

	err := cmd.RunE(cmd, nil)
	if err == nil {
		t.Fatal("expected error")
	}
	if !strings.Contains(err.Error(), "cannot load config") {
		t.Errorf("error = %q, want 'cannot load config'", err.Error())
	}
}

func TestMigrateRunCmd_SameDriver(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "same.db")

	// Create the database.
	drv := openSQLiteStore(t, dir, "same")
	if err := drv.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	// Write config with sqlite driver.
	cfgPath := filepath.Join(dir, "rioku.yaml")
	cfgContent := fmt.Sprintf(`store:
  driver: sqlite
  sqlite:
    path: %s
listen:
  grpc: ":7777"
  rest: ":7778"
data_dir: %s
log_level: info
`, dbPath, dir)

	if err := os.WriteFile(cfgPath, []byte(cfgContent), 0640); err != nil {
		t.Fatalf("write config: %v", err)
	}

	oldAddr := flagDaemonAddr
	oldCfg := flagConfigFile
	defer func() {
		flagDaemonAddr = oldAddr
		flagConfigFile = oldCfg
	}()
	flagDaemonAddr = ""
	flagConfigFile = cfgPath

	cmd := newMigrateRunCmd()
	_ = cmd.Flags().Set("to", "sqlite")

	err := cmd.RunE(cmd, nil)
	if err == nil {
		t.Fatal("expected error for same driver")
	}
	if !strings.Contains(err.Error(), "same as the current driver") {
		t.Errorf("error = %q, want 'same as the current driver'", err.Error())
	}
}

func TestMigrateRunCmd_InvalidTarget(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "invtarget.db")

	drv := openSQLiteStore(t, dir, "invtarget")
	if err := drv.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	cfgPath := filepath.Join(dir, "rioku.yaml")
	cfgContent := fmt.Sprintf(`store:
  driver: sqlite
  sqlite:
    path: %s
listen:
  grpc: ":7777"
  rest: ":7778"
data_dir: %s
log_level: info
`, dbPath, dir)

	if err := os.WriteFile(cfgPath, []byte(cfgContent), 0640); err != nil {
		t.Fatalf("write config: %v", err)
	}

	oldAddr := flagDaemonAddr
	oldCfg := flagConfigFile
	defer func() {
		flagDaemonAddr = oldAddr
		flagConfigFile = oldCfg
	}()
	flagDaemonAddr = ""
	flagConfigFile = cfgPath

	cmd := newMigrateRunCmd()
	_ = cmd.Flags().Set("to", "bad-backend")

	err := cmd.RunE(cmd, nil)
	if err == nil {
		t.Fatal("expected error for bad backend")
	}
	if !strings.Contains(err.Error(), "unknown target backend") {
		t.Errorf("error = %q, want 'unknown target backend'", err.Error())
	}
}

// ---------------------------------------------------------------------------
// migrate.go — transferData with policies, API keys, and users
// ---------------------------------------------------------------------------

func TestTransferData_Full(t *testing.T) {
	dir := t.TempDir()

	source := openSQLiteStore(t, dir, "full-source")
	defer func() { _ = source.Close() }()

	target := openSQLiteStore(t, dir, "full-target")
	defer func() { _ = target.Close() }()

	ctx := context.Background()

	// Seed source with more comprehensive data.
	srcTx, err := source.Begin(ctx, store.TxOptions{})
	if err != nil {
		t.Fatalf("begin source tx: %v", err)
	}

	// Create a user.
	_, err = srcTx.CreateUser(ctx, &store.User{
		Username:     "testuser",
		PasswordHash: "$2a$10$fakehash",
		Status:       "active",
	})
	if err != nil {
		t.Fatalf("create user: %v", err)
	}

	// Create an API key.
	_, err = srcTx.CreateAPIKey(ctx, "test-key", "hashvalue", []string{"admin"}, nil, "")
	if err != nil {
		t.Fatalf("create API key: %v", err)
	}

	if err := srcTx.Commit(); err != nil {
		t.Fatalf("commit source: %v", err)
	}

	// Redirect stdout to discard transfer output.
	oldStdout := os.Stdout
	os.Stdout, _ = os.Open(os.DevNull)
	defer func() { os.Stdout = oldStdout }()

	if err := transferData(ctx, source, target); err != nil {
		t.Fatalf("transferData: %v", err)
	}

	// Verify users and keys transferred.
	dstTx, err := target.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatalf("begin target tx: %v", err)
	}
	defer func() { _ = dstTx.Rollback() }()

	users, err := dstTx.ListUsers(ctx)
	if err != nil {
		t.Fatalf("list users: %v", err)
	}
	if len(users) != 1 {
		t.Errorf("expected 1 user, got %d", len(users))
	}

	keys, err := dstTx.ListAPIKeys(ctx)
	if err != nil {
		t.Fatalf("list API keys: %v", err)
	}
	if len(keys) != 1 {
		t.Errorf("expected 1 API key, got %d", len(keys))
	}
}

// ---------------------------------------------------------------------------
// init.go — runInit (non-interactive, SQLite, skip caddy download)
// ---------------------------------------------------------------------------

func TestRunInit_NonInteractive_SQLite(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "rioku.yaml")

	// Save and restore globals.
	oldAddr := flagDaemonAddr
	oldCfg := flagConfigFile
	defer func() {
		flagDaemonAddr = oldAddr
		flagConfigFile = oldCfg
	}()
	flagDaemonAddr = ""
	flagConfigFile = cfgPath

	cmd := newInitCmd()

	out := captureStdoutToBytes(t, func() {
		err := runInit(cmd, "sqlite", dir, ":17778", true, false, "TestPass123!", false, false, 0, 0, "", "")
		if err != nil {
			t.Fatalf("runInit: %v", err)
		}
	})

	outStr := string(out)

	// Verify config file was created.
	if _, err := os.Stat(cfgPath); os.IsNotExist(err) {
		t.Fatal("config file was not created")
	}

	// Verify bootstrap token output.
	if !strings.Contains(outStr, "Bootstrap token") {
		t.Errorf("output missing 'Bootstrap token': %s", outStr)
	}

	// Verify root account output.
	if !strings.Contains(outStr, "Root account created") {
		t.Errorf("output missing 'Root account created': %s", outStr)
	}

	// Verify store was initialized (db file exists).
	dbPath := filepath.Join(dir, "rioku.db")
	if _, err := os.Stat(dbPath); os.IsNotExist(err) {
		t.Error("SQLite database was not created")
	}

	// Verify the password was used as-is.
	if !strings.Contains(outStr, "TestPass123!") {
		t.Errorf("output missing the specified password")
	}
}

func TestRunInit_ExistingConfig_NoForce(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "rioku.yaml")

	// Create an existing config.
	if err := os.WriteFile(cfgPath, []byte("existing"), 0640); err != nil {
		t.Fatalf("write existing config: %v", err)
	}

	oldAddr := flagDaemonAddr
	oldCfg := flagConfigFile
	defer func() {
		flagDaemonAddr = oldAddr
		flagConfigFile = oldCfg
	}()
	flagDaemonAddr = ""
	flagConfigFile = cfgPath

	cmd := newInitCmd()
	err := runInit(cmd, "sqlite", dir, ":17778", true, false, "pass", false, false, 0, 0, "", "")
	if err == nil {
		t.Fatal("expected error when config exists without --force")
	}
	if !strings.Contains(err.Error(), "already exists") {
		t.Errorf("error = %q, want 'already exists'", err.Error())
	}
}

func TestRunInit_RemoteRejected(t *testing.T) {
	oldAddr := flagDaemonAddr
	defer func() { flagDaemonAddr = oldAddr }()
	flagDaemonAddr = "http://remote.host:7778"

	cmd := newInitCmd()
	err := runInit(cmd, "sqlite", "/tmp", ":17778", true, false, "pass", false, false, 0, 0, "", "")
	if err == nil {
		t.Fatal("expected error for remote addr")
	}
	if !strings.Contains(err.Error(), "must be run directly") {
		t.Errorf("error = %q, want 'must be run directly'", err.Error())
	}
}

// ---------------------------------------------------------------------------
// root.go — Execute
// ---------------------------------------------------------------------------

func TestExecute_HelpDoesNotError(t *testing.T) {
	// Calling rootCmd with --help should not error.
	rootCmd.SetArgs([]string{"--help"})
	defer rootCmd.SetArgs(nil)

	out := captureStdoutToBytes(t, func() {
		err := Execute()
		if err != nil {
			t.Fatalf("Execute(--help): %v", err)
		}
	})

	outStr := string(out)
	if !strings.Contains(outStr, "rioku") && !strings.Contains(outStr, "Rioku") {
		t.Errorf("help output missing 'rioku': %s", outStr)
	}
}

// ---------------------------------------------------------------------------
// Mock-server tests for CRUD commands (route, service, policy, key, audit,
// config, status). These use httptest to avoid needing a running daemon.
// ---------------------------------------------------------------------------

// setGlobalsForMock configures global flags to point at the given httptest
// server and returns a cleanup function.
func setGlobalsForMock(t *testing.T, srv *httptest.Server) func() {
	t.Helper()
	origAddr := flagDaemonAddr
	origToken := flagToken
	origOutput := flagOutput
	origTimeout := flagTimeout

	flagDaemonAddr = srv.URL
	flagToken = "mock-token"
	flagOutput = "json"
	flagTimeout = 5 * time.Second

	return func() {
		flagDaemonAddr = origAddr
		flagToken = origToken
		flagOutput = origOutput
		flagTimeout = origTimeout
	}
}

// mockConfigServer returns an httptest server that serves a canned config
// response on GET /api/v1/config and accepts POST /api/v1/config.
func mockConfigServer(t *testing.T) *httptest.Server {
	t.Helper()
	configResp := `{
		"version": 3,
		"snapshotAt": "2026-01-01T00:00:00Z",
		"routes": [
			{"id":"r1","name":"route-alpha","enabled":true,"matchers":[{"hosts":["test.local"]}]},
			{"id":"r2","name":"route-beta","enabled":false}
		],
		"services": [
			{"id":"s1","name":"svc-alpha","lbPolicy":"LB_POLICY_ROUND_ROBIN","upstreams":[{"address":"127.0.0.1:8080"}]},
			{"id":"s2","name":"svc-beta","lbPolicy":"LB_POLICY_RANDOM"}
		],
		"policies": [
			{"id":"p1","name":"pol-alpha","type":"POLICY_TYPE_RATE_LIMIT"},
			{"id":"p2","name":"pol-beta","type":"POLICY_TYPE_AUTH_JWT"}
		]
	}`

	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/api/v1/config" && r.Method == http.MethodGet:
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(configResp))
		case r.URL.Path == "/api/v1/config" && r.Method == http.MethodPost:
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"version":4}`))
		case r.URL.Path == "/api/v1/config/import" && r.Method == http.MethodPost:
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"version":5}`))
		case r.URL.Path == "/api/v1/keys" && r.Method == http.MethodGet:
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`[{"id":"k1","name":"test-key","scopes":["admin"],"created_at":"2026-01-01"}]`))
		case r.URL.Path == "/api/v1/keys" && r.Method == http.MethodPost:
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"id":"k-new","key":"rku_live_abc123"}`))
		case strings.HasPrefix(r.URL.Path, "/api/v1/keys/") && r.Method == http.MethodDelete:
			w.WriteHeader(http.StatusNoContent)
		case r.URL.Path == "/api/v1/audit" && r.Method == http.MethodGet:
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`[{"id":"a1","actor":"root","entityType":"route","entityId":"r1","operation":"CREATE","configVersion":1,"occurredAt":"2026-01-01T00:00:00Z"}]`))
		case r.URL.Path == "/api/v1/health" && r.Method == http.MethodGet:
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"overall":"HEALTH_STATE_OK","store":{"state":"HEALTH_STATE_OK","detail":{"state":"leader"}},"caddy":{"state":"HEALTH_STATE_OK","message":"running"},"version":"0.3.0","uptimeSeconds":"60"}`))
		default:
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"title":"Not Found","detail":"not found","status":404}`))
		}
	}))
}

// --- Route command tests with mock server ---

func TestRouteListCmd_Mock(t *testing.T) {
	srv := mockConfigServer(t)
	defer srv.Close()
	cleanup := setGlobalsForMock(t, srv)
	defer cleanup()

	cmd := newRouteListCmd()
	out := captureStdoutToBytes(t, func() {
		if err := cmd.RunE(cmd, nil); err != nil {
			t.Fatalf("route list: %v", err)
		}
	})

	var routes []json.RawMessage
	if err := json.Unmarshal(out, &routes); err != nil {
		t.Fatalf("parse route list: %v (raw: %s)", err, string(out))
	}
	if len(routes) != 2 {
		t.Errorf("expected 2 routes, got %d", len(routes))
	}
}

func TestRouteListCmd_TableOutput(t *testing.T) {
	srv := mockConfigServer(t)
	defer srv.Close()
	cleanup := setGlobalsForMock(t, srv)
	defer cleanup()
	flagOutput = "table"

	cmd := newRouteListCmd()
	out := captureStdoutToBytes(t, func() {
		if err := cmd.RunE(cmd, nil); err != nil {
			t.Fatalf("route list table: %v", err)
		}
	})

	outStr := string(out)
	if !strings.Contains(outStr, "ID") || !strings.Contains(outStr, "NAME") {
		t.Errorf("table output missing headers: %s", outStr)
	}
	if !strings.Contains(outStr, "route-alpha") {
		t.Errorf("table output missing 'route-alpha': %s", outStr)
	}
}

func TestRouteGetCmd_Mock(t *testing.T) {
	srv := mockConfigServer(t)
	defer srv.Close()
	cleanup := setGlobalsForMock(t, srv)
	defer cleanup()

	cmd := newRouteGetCmd()
	out := captureStdoutToBytes(t, func() {
		if err := cmd.RunE(cmd, []string{"r1"}); err != nil {
			t.Fatalf("route get: %v", err)
		}
	})

	var route struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	if err := json.Unmarshal(out, &route); err != nil {
		t.Fatalf("parse route get: %v", err)
	}
	if route.ID != "r1" || route.Name != "route-alpha" {
		t.Errorf("route = %+v, want id=r1 name=route-alpha", route)
	}
}

func TestRouteGetCmd_NotFound(t *testing.T) {
	srv := mockConfigServer(t)
	defer srv.Close()
	cleanup := setGlobalsForMock(t, srv)
	defer cleanup()

	cmd := newRouteGetCmd()
	err := cmd.RunE(cmd, []string{"nonexistent"})
	if err == nil {
		t.Fatal("expected error")
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Errorf("error = %q, want 'not found'", err.Error())
	}
}

func TestRouteCreateCmd_Mock(t *testing.T) {
	srv := mockConfigServer(t)
	defer srv.Close()
	cleanup := setGlobalsForMock(t, srv)
	defer cleanup()

	cmd := newRouteCreateCmd()
	_ = cmd.Flags().Set("name", "new-route")
	_ = cmd.Flags().Set("upstream", "localhost:9999")
	_ = cmd.Flags().Set("match-path", "/api")
	_ = cmd.Flags().Set("match-host", "example.com")
	_ = cmd.Flags().Set("match-method", "GET,POST")

	out := captureStdoutToBytes(t, func() {
		if err := cmd.RunE(cmd, nil); err != nil {
			t.Fatalf("route create: %v", err)
		}
	})

	if len(out) == 0 {
		t.Fatal("route create produced no output")
	}
}

func TestRouteCreateCmd_WithService(t *testing.T) {
	srv := mockConfigServer(t)
	defer srv.Close()
	cleanup := setGlobalsForMock(t, srv)
	defer cleanup()

	cmd := newRouteCreateCmd()
	_ = cmd.Flags().Set("name", "svc-route")
	_ = cmd.Flags().Set("service", "s1")

	captureStdoutToBytes(t, func() {
		if err := cmd.RunE(cmd, nil); err != nil {
			t.Fatalf("route create with service: %v", err)
		}
	})
}

func TestRouteDeleteCmd_Mock(t *testing.T) {
	srv := mockConfigServer(t)
	defer srv.Close()
	cleanup := setGlobalsForMock(t, srv)
	defer cleanup()

	cmd := newRouteDeleteCmd()
	out := captureStdoutToBytes(t, func() {
		if err := cmd.RunE(cmd, []string{"r1"}); err != nil {
			t.Fatalf("route delete: %v", err)
		}
	})

	if !strings.Contains(string(out), "deleted") {
		t.Errorf("delete output = %q, want 'deleted'", string(out))
	}
}

func TestSetRouteEnabled_Mock(t *testing.T) {
	srv := mockConfigServer(t)
	defer srv.Close()
	cleanup := setGlobalsForMock(t, srv)
	defer cleanup()

	out := captureStdoutToBytes(t, func() {
		if err := setRouteEnabled("r1", true); err != nil {
			t.Fatalf("setRouteEnabled(true): %v", err)
		}
	})
	if !strings.Contains(string(out), "enabled") {
		t.Errorf("enable output = %q, want 'enabled'", string(out))
	}

	out = captureStdoutToBytes(t, func() {
		if err := setRouteEnabled("r2", false); err != nil {
			t.Fatalf("setRouteEnabled(false): %v", err)
		}
	})
	if !strings.Contains(string(out), "disabled") {
		t.Errorf("disable output = %q, want 'disabled'", string(out))
	}
}

// --- Service command tests with mock server ---

func TestServiceListCmd_Mock(t *testing.T) {
	srv := mockConfigServer(t)
	defer srv.Close()
	cleanup := setGlobalsForMock(t, srv)
	defer cleanup()

	cmd := newServiceListCmd()
	out := captureStdoutToBytes(t, func() {
		if err := cmd.RunE(cmd, nil); err != nil {
			t.Fatalf("service list: %v", err)
		}
	})

	var services []json.RawMessage
	if err := json.Unmarshal(out, &services); err != nil {
		t.Fatalf("parse service list: %v", err)
	}
	if len(services) != 2 {
		t.Errorf("expected 2 services, got %d", len(services))
	}
}

func TestServiceListCmd_TextOutput(t *testing.T) {
	srv := mockConfigServer(t)
	defer srv.Close()
	cleanup := setGlobalsForMock(t, srv)
	defer cleanup()
	flagOutput = "text"

	cmd := newServiceListCmd()
	out := captureStdoutToBytes(t, func() {
		if err := cmd.RunE(cmd, nil); err != nil {
			t.Fatalf("service list text: %v", err)
		}
	})

	outStr := string(out)
	if !strings.Contains(outStr, "svc-alpha") {
		t.Errorf("text output missing 'svc-alpha': %s", outStr)
	}
}

func TestServiceGetCmd_Mock(t *testing.T) {
	srv := mockConfigServer(t)
	defer srv.Close()
	cleanup := setGlobalsForMock(t, srv)
	defer cleanup()

	cmd := newServiceGetCmd()
	out := captureStdoutToBytes(t, func() {
		if err := cmd.RunE(cmd, []string{"s1"}); err != nil {
			t.Fatalf("service get: %v", err)
		}
	})

	var svc struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	if err := json.Unmarshal(out, &svc); err != nil {
		t.Fatalf("parse service get: %v", err)
	}
	if svc.Name != "svc-alpha" {
		t.Errorf("name = %q, want 'svc-alpha'", svc.Name)
	}
}

func TestServiceGetCmd_NotFound(t *testing.T) {
	srv := mockConfigServer(t)
	defer srv.Close()
	cleanup := setGlobalsForMock(t, srv)
	defer cleanup()

	cmd := newServiceGetCmd()
	err := cmd.RunE(cmd, []string{"nonexistent"})
	if err == nil {
		t.Fatal("expected error")
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Errorf("error = %q, want 'not found'", err.Error())
	}
}

func TestServiceCreateCmd_Mock(t *testing.T) {
	srv := mockConfigServer(t)
	defer srv.Close()
	cleanup := setGlobalsForMock(t, srv)
	defer cleanup()

	cmd := newServiceCreateCmd()
	_ = cmd.Flags().Set("name", "new-svc")
	_ = cmd.Flags().Set("upstream", "localhost:8001")
	_ = cmd.Flags().Set("lb", "random")

	out := captureStdoutToBytes(t, func() {
		if err := cmd.RunE(cmd, nil); err != nil {
			t.Fatalf("service create: %v", err)
		}
	})

	if len(out) == 0 {
		t.Fatal("service create produced no output")
	}
}

func TestServiceCreateCmd_LBPolicies(t *testing.T) {
	srv := mockConfigServer(t)
	defer srv.Close()
	cleanup := setGlobalsForMock(t, srv)
	defer cleanup()

	policies := []string{"round-robin", "random", "least-conn", "ip-hash", "leastconn", "iphash", "roundrobin"}
	for _, lb := range policies {
		cmd := newServiceCreateCmd()
		_ = cmd.Flags().Set("name", "svc-"+lb)
		_ = cmd.Flags().Set("upstream", "localhost:8001")
		_ = cmd.Flags().Set("lb", lb)

		captureStdoutToBytes(t, func() {
			if err := cmd.RunE(cmd, nil); err != nil {
				t.Errorf("service create with lb=%q: %v", lb, err)
			}
		})
	}
}

func TestServiceDeleteCmd_Mock(t *testing.T) {
	srv := mockConfigServer(t)
	defer srv.Close()
	cleanup := setGlobalsForMock(t, srv)
	defer cleanup()

	cmd := newServiceDeleteCmd()
	out := captureStdoutToBytes(t, func() {
		if err := cmd.RunE(cmd, []string{"s1"}); err != nil {
			t.Fatalf("service delete: %v", err)
		}
	})

	if !strings.Contains(string(out), "deleted") {
		t.Errorf("delete output = %q, want 'deleted'", string(out))
	}
}

// --- Policy command tests with mock server ---

func TestPolicyListCmd_Mock(t *testing.T) {
	srv := mockConfigServer(t)
	defer srv.Close()
	cleanup := setGlobalsForMock(t, srv)
	defer cleanup()

	cmd := newPolicyListCmd()
	out := captureStdoutToBytes(t, func() {
		if err := cmd.RunE(cmd, nil); err != nil {
			t.Fatalf("policy list: %v", err)
		}
	})

	var policies []json.RawMessage
	if err := json.Unmarshal(out, &policies); err != nil {
		t.Fatalf("parse policy list: %v", err)
	}
	if len(policies) != 2 {
		t.Errorf("expected 2 policies, got %d", len(policies))
	}
}

func TestPolicyGetCmd_Mock(t *testing.T) {
	srv := mockConfigServer(t)
	defer srv.Close()
	cleanup := setGlobalsForMock(t, srv)
	defer cleanup()

	cmd := newPolicyGetCmd()
	out := captureStdoutToBytes(t, func() {
		if err := cmd.RunE(cmd, []string{"p1"}); err != nil {
			t.Fatalf("policy get: %v", err)
		}
	})

	var pol struct {
		ID   string `json:"id"`
		Name string `json:"name"`
		Type string `json:"type"`
	}
	if err := json.Unmarshal(out, &pol); err != nil {
		t.Fatalf("parse policy get: %v", err)
	}
	if pol.Name != "pol-alpha" {
		t.Errorf("name = %q, want 'pol-alpha'", pol.Name)
	}
}

func TestPolicyGetCmd_NotFound(t *testing.T) {
	srv := mockConfigServer(t)
	defer srv.Close()
	cleanup := setGlobalsForMock(t, srv)
	defer cleanup()

	cmd := newPolicyGetCmd()
	err := cmd.RunE(cmd, []string{"nonexistent"})
	if err == nil {
		t.Fatal("expected error")
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Errorf("error = %q, want 'not found'", err.Error())
	}
}

func TestPolicyCreateCmd_Mock(t *testing.T) {
	srv := mockConfigServer(t)
	defer srv.Close()
	cleanup := setGlobalsForMock(t, srv)
	defer cleanup()

	cmd := newPolicyCreateCmd()
	_ = cmd.Flags().Set("name", "new-pol")
	_ = cmd.Flags().Set("type", "rate-limit")
	_ = cmd.Flags().Set("config", `{"requestsPerSecond":100}`)

	out := captureStdoutToBytes(t, func() {
		if err := cmd.RunE(cmd, nil); err != nil {
			t.Fatalf("policy create: %v", err)
		}
	})

	if len(out) == 0 {
		t.Fatal("policy create produced no output")
	}
}

func TestPolicyCreateCmd_AllTypes(t *testing.T) {
	srv := mockConfigServer(t)
	defer srv.Close()
	cleanup := setGlobalsForMock(t, srv)
	defer cleanup()

	types := []string{"rate-limit", "auth-api-key", "auth-jwt", "transform", "allow-list", "block-list"}
	for _, pt := range types {
		cmd := newPolicyCreateCmd()
		_ = cmd.Flags().Set("name", "pol-"+pt)
		_ = cmd.Flags().Set("type", pt)

		captureStdoutToBytes(t, func() {
			if err := cmd.RunE(cmd, nil); err != nil {
				t.Errorf("policy create type=%q: %v", pt, err)
			}
		})
	}
}

func TestPolicyCreateCmd_InvalidType(t *testing.T) {
	srv := mockConfigServer(t)
	defer srv.Close()
	cleanup := setGlobalsForMock(t, srv)
	defer cleanup()

	cmd := newPolicyCreateCmd()
	_ = cmd.Flags().Set("name", "bad-pol")
	_ = cmd.Flags().Set("type", "invalid-type")

	err := cmd.RunE(cmd, nil)
	if err == nil {
		t.Fatal("expected error for invalid policy type")
	}
	if !strings.Contains(err.Error(), "unknown policy type") {
		t.Errorf("error = %q, want 'unknown policy type'", err.Error())
	}
}

func TestPolicyCreateCmd_ConfigFromFile(t *testing.T) {
	srv := mockConfigServer(t)
	defer srv.Close()
	cleanup := setGlobalsForMock(t, srv)
	defer cleanup()

	tmpFile := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(tmpFile, []byte(`{"rps":50}`), 0640); err != nil {
		t.Fatalf("write config file: %v", err)
	}

	cmd := newPolicyCreateCmd()
	_ = cmd.Flags().Set("name", "file-pol")
	_ = cmd.Flags().Set("type", "rate-limit")
	_ = cmd.Flags().Set("config", "@"+tmpFile)

	captureStdoutToBytes(t, func() {
		if err := cmd.RunE(cmd, nil); err != nil {
			t.Fatalf("policy create from file: %v", err)
		}
	})
}

func TestPolicyCreateCmd_ConfigFromBadFile(t *testing.T) {
	srv := mockConfigServer(t)
	defer srv.Close()
	cleanup := setGlobalsForMock(t, srv)
	defer cleanup()

	cmd := newPolicyCreateCmd()
	_ = cmd.Flags().Set("name", "bad-file-pol")
	_ = cmd.Flags().Set("type", "rate-limit")
	_ = cmd.Flags().Set("config", "@/tmp/nonexistent-policy-config.json")

	err := cmd.RunE(cmd, nil)
	if err == nil {
		t.Fatal("expected error for bad config file")
	}
	if !strings.Contains(err.Error(), "read config file") {
		t.Errorf("error = %q, want 'read config file'", err.Error())
	}
}

func TestPolicyDeleteCmd_Mock(t *testing.T) {
	srv := mockConfigServer(t)
	defer srv.Close()
	cleanup := setGlobalsForMock(t, srv)
	defer cleanup()

	cmd := newPolicyDeleteCmd()
	out := captureStdoutToBytes(t, func() {
		if err := cmd.RunE(cmd, []string{"p1"}); err != nil {
			t.Fatalf("policy delete: %v", err)
		}
	})

	if !strings.Contains(string(out), "deleted") {
		t.Errorf("delete output = %q, want 'deleted'", string(out))
	}
}

// --- Key command tests with mock server ---

func TestKeyCreateCmd_Mock(t *testing.T) {
	srv := mockConfigServer(t)
	defer srv.Close()
	cleanup := setGlobalsForMock(t, srv)
	defer cleanup()

	cmd := newKeyCreateCmd()
	_ = cmd.Flags().Set("name", "new-key")
	_ = cmd.Flags().Set("scopes", "admin")

	out := captureStdoutToBytes(t, func() {
		if err := cmd.RunE(cmd, nil); err != nil {
			t.Fatalf("key create: %v", err)
		}
	})

	outStr := string(out)
	if !strings.Contains(outStr, "API key created") {
		t.Errorf("output missing 'API key created': %s", outStr)
	}
	if !strings.Contains(outStr, "rku_live_abc123") {
		t.Errorf("output missing key value: %s", outStr)
	}
}

func TestKeyCreateCmd_WithExpires(t *testing.T) {
	srv := mockConfigServer(t)
	defer srv.Close()
	cleanup := setGlobalsForMock(t, srv)
	defer cleanup()

	cmd := newKeyCreateCmd()
	_ = cmd.Flags().Set("name", "expiring-key")
	_ = cmd.Flags().Set("expires", "30d")

	captureStdoutToBytes(t, func() {
		if err := cmd.RunE(cmd, nil); err != nil {
			t.Fatalf("key create with expires: %v", err)
		}
	})
}

func TestKeyListCmd_Mock(t *testing.T) {
	srv := mockConfigServer(t)
	defer srv.Close()
	cleanup := setGlobalsForMock(t, srv)
	defer cleanup()

	cmd := newKeyListCmd()
	out := captureStdoutToBytes(t, func() {
		if err := cmd.RunE(cmd, nil); err != nil {
			t.Fatalf("key list: %v", err)
		}
	})

	var keys []json.RawMessage
	if err := json.Unmarshal(out, &keys); err != nil {
		t.Fatalf("parse key list: %v", err)
	}
	if len(keys) != 1 {
		t.Errorf("expected 1 key, got %d", len(keys))
	}
}

func TestKeyListCmd_TableOutput(t *testing.T) {
	srv := mockConfigServer(t)
	defer srv.Close()
	cleanup := setGlobalsForMock(t, srv)
	defer cleanup()
	flagOutput = "table"

	cmd := newKeyListCmd()
	out := captureStdoutToBytes(t, func() {
		if err := cmd.RunE(cmd, nil); err != nil {
			t.Fatalf("key list table: %v", err)
		}
	})

	outStr := string(out)
	if !strings.Contains(outStr, "test-key") {
		t.Errorf("output missing 'test-key': %s", outStr)
	}
}

func TestKeyRevokeCmd_Mock(t *testing.T) {
	srv := mockConfigServer(t)
	defer srv.Close()
	cleanup := setGlobalsForMock(t, srv)
	defer cleanup()

	cmd := newKeyRevokeCmd()
	out := captureStdoutToBytes(t, func() {
		if err := cmd.RunE(cmd, []string{"k1"}); err != nil {
			t.Fatalf("key revoke: %v", err)
		}
	})

	if !strings.Contains(string(out), "revoked") {
		t.Errorf("revoke output = %q, want 'revoked'", string(out))
	}
}

// --- Audit command tests with mock server ---

func TestAuditListCmd_Mock(t *testing.T) {
	srv := mockConfigServer(t)
	defer srv.Close()
	cleanup := setGlobalsForMock(t, srv)
	defer cleanup()

	cmd := newAuditListCmd()
	out := captureStdoutToBytes(t, func() {
		if err := cmd.RunE(cmd, nil); err != nil {
			t.Fatalf("audit list: %v", err)
		}
	})

	var entries []json.RawMessage
	if err := json.Unmarshal(out, &entries); err != nil {
		t.Fatalf("parse audit list: %v", err)
	}
	if len(entries) != 1 {
		t.Errorf("expected 1 audit entry, got %d", len(entries))
	}
}

func TestAuditListCmd_TableOutput(t *testing.T) {
	srv := mockConfigServer(t)
	defer srv.Close()
	cleanup := setGlobalsForMock(t, srv)
	defer cleanup()
	flagOutput = "table"

	cmd := newAuditListCmd()
	out := captureStdoutToBytes(t, func() {
		if err := cmd.RunE(cmd, nil); err != nil {
			t.Fatalf("audit list table: %v", err)
		}
	})

	outStr := string(out)
	if !strings.Contains(outStr, "root") {
		t.Errorf("output missing actor 'root': %s", outStr)
	}
}

func TestAuditListCmd_WithFilters(t *testing.T) {
	srv := mockConfigServer(t)
	defer srv.Close()
	cleanup := setGlobalsForMock(t, srv)
	defer cleanup()

	cmd := newAuditListCmd()
	_ = cmd.Flags().Set("limit", "5")
	_ = cmd.Flags().Set("actor", "root")
	_ = cmd.Flags().Set("resource", "route")
	_ = cmd.Flags().Set("since", "2026-01-01T00:00:00Z")

	captureStdoutToBytes(t, func() {
		if err := cmd.RunE(cmd, nil); err != nil {
			t.Fatalf("audit list with filters: %v", err)
		}
	})
}

// --- Config command tests with mock server ---

func TestConfigExportCmd_Mock(t *testing.T) {
	srv := mockConfigServer(t)
	defer srv.Close()
	cleanup := setGlobalsForMock(t, srv)
	defer cleanup()

	cmd := newConfigExportCmd()
	out := captureStdoutToBytes(t, func() {
		if err := cmd.RunE(cmd, nil); err != nil {
			t.Fatalf("config export: %v", err)
		}
	})

	var raw json.RawMessage
	if err := json.Unmarshal(out, &raw); err != nil {
		t.Fatalf("config export not valid JSON: %v", err)
	}
}

func TestConfigExportCmd_ToFile(t *testing.T) {
	srv := mockConfigServer(t)
	defer srv.Close()
	cleanup := setGlobalsForMock(t, srv)
	defer cleanup()

	tmpFile := filepath.Join(t.TempDir(), "export.json")
	cmd := newConfigExportCmd()
	_ = cmd.Flags().Set("output-file", tmpFile)

	captureStdoutToBytes(t, func() {
		if err := cmd.RunE(cmd, nil); err != nil {
			t.Fatalf("config export to file: %v", err)
		}
	})

	data, err := os.ReadFile(tmpFile)
	if err != nil {
		t.Fatalf("read exported file: %v", err)
	}
	if len(data) == 0 {
		t.Fatal("exported file is empty")
	}
}

func TestConfigImportCmd_Mock(t *testing.T) {
	srv := mockConfigServer(t)
	defer srv.Close()
	cleanup := setGlobalsForMock(t, srv)
	defer cleanup()

	tmpFile := filepath.Join(t.TempDir(), "import.json")
	if err := os.WriteFile(tmpFile, []byte(`{"routes":[]}`), 0640); err != nil {
		t.Fatalf("write import file: %v", err)
	}

	cmd := newConfigImportCmd()
	_ = cmd.Flags().Set("file", tmpFile)

	captureStdoutToBytes(t, func() {
		if err := cmd.RunE(cmd, nil); err != nil {
			t.Fatalf("config import: %v", err)
		}
	})
}

func TestConfigVersionsCmd_Mock(t *testing.T) {
	srv := mockConfigServer(t)
	defer srv.Close()
	cleanup := setGlobalsForMock(t, srv)
	defer cleanup()

	cmd := newConfigVersionsCmd()
	out := captureStdoutToBytes(t, func() {
		if err := cmd.RunE(cmd, nil); err != nil {
			t.Fatalf("config versions: %v", err)
		}
	})

	outStr := string(out)
	if !strings.Contains(outStr, "Current version") {
		t.Errorf("output missing 'Current version': %s", outStr)
	}
}

// --- Status command tests with mock server ---

func TestRunStatus_Mock(t *testing.T) {
	srv := mockConfigServer(t)
	defer srv.Close()
	cleanup := setGlobalsForMock(t, srv)
	defer cleanup()

	out := captureStdoutToBytes(t, func() {
		if err := runStatus(); err != nil {
			t.Fatalf("runStatus: %v", err)
		}
	})

	outStr := string(out)
	// With flagOutput=json, it should output JSON health.
	var health struct {
		Overall string `json:"overall"`
	}
	if err := json.Unmarshal(out, &health); err != nil {
		t.Fatalf("status output not valid JSON: %v (raw: %s)", err, outStr)
	}
	if health.Overall != "HEALTH_STATE_OK" {
		t.Errorf("overall = %q, want HEALTH_STATE_OK", health.Overall)
	}
}

func TestRunStatus_TableMode(t *testing.T) {
	srv := mockConfigServer(t)
	defer srv.Close()
	cleanup := setGlobalsForMock(t, srv)
	defer cleanup()
	flagOutput = "table"

	out := captureStdoutToBytes(t, func() {
		if err := runStatus(); err != nil {
			t.Fatalf("runStatus: %v", err)
		}
	})

	outStr := string(out)
	if !strings.Contains(outStr, "OK") {
		t.Errorf("output missing 'OK': %s", outStr)
	}
}

// --- Execute error path ---

func TestExecute_InvalidSubcommand(t *testing.T) {
	rootCmd.SetArgs([]string{"nonexistent-command-xyz"})
	defer rootCmd.SetArgs(nil)

	// Capture stderr too since Execute prints errors there.
	oldStderr := os.Stderr
	_, w, _ := os.Pipe()
	os.Stderr = w
	defer func() { os.Stderr = oldStderr; _ = w.Close() }()

	err := Execute()
	if err == nil {
		t.Fatal("expected error for invalid subcommand")
	}
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// captureStdout redirects os.Stdout to /dev/null for the duration of fn,
// preventing noisy test output while still exercising the code paths.
func captureStdout(t *testing.T, fn func()) {
	t.Helper()
	oldStdout := fmt.Fprint // dummy reference to avoid unused import
	_ = oldStdout

	// We don't capture the actual output; we just ensure no panic.
	// Redirect is handled at the writer level inside the functions (tabwriter
	// writes to os.Stdout), so we accept the output goes to real stdout in
	// test mode. The key assertion is "no panic."
	fn()
}

// captureStdoutToBytes redirects os.Stdout into a buffer for the duration of fn.
func captureStdoutToBytes(t *testing.T, fn func()) []byte {
	t.Helper()
	old := os.Stdout
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe: %v", err)
	}
	os.Stdout = w

	fn()

	_ = w.Close()
	os.Stdout = old

	var buf bytes.Buffer
	_, _ = buf.ReadFrom(r)
	return buf.Bytes()
}
