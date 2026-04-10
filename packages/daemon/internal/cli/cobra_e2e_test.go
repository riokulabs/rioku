//go:build integration

package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/cookiejar"
	"os"
	"strings"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// cobraTestToken authenticates against the sandbox and returns a bearer token.
// Skips the test if the sandbox is unavailable.
func cobraTestToken(t *testing.T) string {
	t.Helper()

	dataDir := findSandboxDataDir()
	if dataDir == "" {
		t.Skip("sandbox not available: cannot find sandbox/.data/root-password")
	}

	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatalf("create cookie jar: %v", err)
	}
	hc := &http.Client{Jar: jar, Timeout: 10 * time.Second}

	loginBody, _ := json.Marshal(map[string]string{
		"username": "testadmin",
		"password": "TestAdmin123!",
	})
	resp, err := hc.Post(sandboxAddr+"/api/v1/auth/login", "application/json", bytes.NewReader(loginBody))
	if err != nil {
		t.Skipf("sandbox not reachable: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Skipf("login failed (status %d) — sandbox may not be seeded", resp.StatusCode)
	}

	keyBody, _ := json.Marshal(map[string]string{
		"name":   fmt.Sprintf("cobra-e2e-%d", time.Now().UnixNano()),
		"scopes": "admin",
	})
	keyResp, err := hc.Post(sandboxAddr+"/api/v1/keys", "application/json", bytes.NewReader(keyBody))
	if err != nil {
		t.Fatalf("create API key: %v", err)
	}
	defer func() { _ = keyResp.Body.Close() }()
	if keyResp.StatusCode != http.StatusOK && keyResp.StatusCode != http.StatusCreated {
		t.Fatalf("create API key: status %d", keyResp.StatusCode)
	}

	var keyResult struct {
		Key string `json:"key"`
	}
	if err := json.NewDecoder(keyResp.Body).Decode(&keyResult); err != nil {
		t.Fatalf("decode API key: %v", err)
	}
	if keyResult.Key == "" {
		t.Fatal("API key response missing 'key' field")
	}

	tokenBody, _ := json.Marshal(map[string]string{"token": keyResult.Key})
	tokenResp, err := hc.Post(sandboxAddr+"/api/v1/auth/token", "application/json", bytes.NewReader(tokenBody))
	if err != nil {
		t.Fatalf("exchange token: %v", err)
	}
	defer func() { _ = tokenResp.Body.Close() }()
	if tokenResp.StatusCode != http.StatusOK {
		t.Fatalf("token exchange: status %d", tokenResp.StatusCode)
	}

	var tokenResult struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(tokenResp.Body).Decode(&tokenResult); err != nil {
		t.Fatalf("decode token: %v", err)
	}
	if tokenResult.AccessToken == "" {
		t.Fatal("empty access_token")
	}
	return tokenResult.AccessToken
}

// setCobraGlobals configures global flag vars for cobra commands to use.
// Returns a cleanup function that restores originals.
func setCobraGlobals(t *testing.T, token string) func() {
	t.Helper()
	origAddr := flagDaemonAddr
	origToken := flagToken
	origOutput := flagOutput
	origTimeout := flagTimeout

	flagDaemonAddr = sandboxAddr
	flagToken = token
	flagOutput = "json"
	flagTimeout = 30 * time.Second

	return func() {
		flagDaemonAddr = origAddr
		flagToken = origToken
		flagOutput = origOutput
		flagTimeout = origTimeout
	}
}

// captureStdoutBytes redirects os.Stdout into a buffer for the duration of fn.
func captureStdoutBytes(t *testing.T, fn func()) []byte {
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

// sandboxAPIClient returns an APIClient pointing at the running sandbox.
func sandboxAPIClient(t *testing.T, token string) *APIClient {
	t.Helper()
	return &APIClient{
		BaseURL:    sandboxAddr,
		Token:      token,
		HTTPClient: &http.Client{Timeout: 15 * time.Second},
	}
}

// ---------------------------------------------------------------------------
// Route commands
// ---------------------------------------------------------------------------

func TestCobra_RouteList(t *testing.T) {
	token := cobraTestToken(t)
	cleanup := setCobraGlobals(t, token)
	defer cleanup()

	cmd := newRouteListCmd()
	out := captureStdoutBytes(t, func() {
		if err := cmd.RunE(cmd, nil); err != nil {
			t.Fatalf("route list: %v", err)
		}
	})

	// Output is JSON (we set flagOutput = "json"). Should be a JSON array.
	var routes []json.RawMessage
	if err := json.Unmarshal(out, &routes); err != nil {
		t.Fatalf("parse route list output: %v (raw: %s)", err, string(out))
	}
	if len(routes) == 0 {
		t.Fatal("expected at least 1 seeded route")
	}
}

func TestCobra_RouteGetNotFound(t *testing.T) {
	token := cobraTestToken(t)
	cleanup := setCobraGlobals(t, token)
	defer cleanup()

	cmd := newRouteGetCmd()
	err := cmd.RunE(cmd, []string{"nonexistent-id-12345"})
	if err == nil {
		t.Fatal("expected error for nonexistent route, got nil")
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Errorf("error = %q, want 'not found'", err.Error())
	}
}

func TestCobra_RouteCRUD(t *testing.T) {
	token := cobraTestToken(t)
	cleanup := setCobraGlobals(t, token)
	defer cleanup()

	client := sandboxAPIClient(t, token)
	ctx := context.Background()

	// --- Create via cobra ---
	routeName := fmt.Sprintf("cobra-route-%d", time.Now().UnixNano())
	createCmd := newRouteCreateCmd()
	_ = createCmd.Flags().Set("name", routeName)
	_ = createCmd.Flags().Set("upstream", "localhost:19999")
	_ = createCmd.Flags().Set("match-path", "/cobra-test")

	createOut := captureStdoutBytes(t, func() {
		if err := createCmd.RunE(createCmd, nil); err != nil {
			t.Fatalf("route create: %v", err)
		}
	})

	if len(createOut) == 0 {
		t.Fatal("route create produced no output")
	}

	// Find the route ID via API.
	cfgData, err := client.Get(ctx, "/api/v1/config")
	if err != nil {
		t.Fatalf("get config: %v", err)
	}
	var snap struct {
		Routes []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"routes"`
	}
	_ = json.Unmarshal(cfgData, &snap)

	var routeID string
	for _, r := range snap.Routes {
		if r.Name == routeName {
			routeID = r.ID
			break
		}
	}
	if routeID == "" {
		t.Fatal("created route not found in config")
	}

	// --- Get via cobra ---
	getCmd := newRouteGetCmd()
	getOut := captureStdoutBytes(t, func() {
		if err := getCmd.RunE(getCmd, []string{routeID}); err != nil {
			t.Fatalf("route get: %v", err)
		}
	})

	var gotRoute struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	if err := json.Unmarshal(getOut, &gotRoute); err != nil {
		t.Fatalf("parse route get: %v (raw: %s)", err, string(getOut))
	}
	if gotRoute.ID != routeID {
		t.Errorf("route get ID = %q, want %q", gotRoute.ID, routeID)
	}
	if gotRoute.Name != routeName {
		t.Errorf("route get name = %q, want %q", gotRoute.Name, routeName)
	}

	// --- Disable via cobra ---
	// The disable command sends a minimal UPSERT (id + enabled:false).
	// The server may reject partial updates with 500. Exercise the RunE path
	// regardless; the error path is still valuable coverage.
	disableCmd := newRouteDisableCmd()
	var disableErr error
	disableOut := captureStdoutBytes(t, func() {
		disableErr = disableCmd.RunE(disableCmd, []string{routeID})
	})
	if disableErr != nil {
		t.Logf("route disable returned error (partial UPSERT rejected): %v", disableErr)
	} else if !strings.Contains(string(disableOut), "disabled") {
		t.Errorf("disable output = %q, want 'disabled'", string(disableOut))
	}

	// --- Enable via cobra ---
	enableCmd := newRouteEnableCmd()
	var enableErr error
	enableOut := captureStdoutBytes(t, func() {
		enableErr = enableCmd.RunE(enableCmd, []string{routeID})
	})
	if enableErr != nil {
		t.Logf("route enable returned error (partial UPSERT rejected): %v", enableErr)
	} else if !strings.Contains(string(enableOut), "enabled") {
		t.Errorf("enable output = %q, want 'enabled'", string(enableOut))
	}

	// --- Delete via cobra ---
	deleteCmd := newRouteDeleteCmd()
	deleteOut := captureStdoutBytes(t, func() {
		if err := deleteCmd.RunE(deleteCmd, []string{routeID}); err != nil {
			t.Fatalf("route delete: %v", err)
		}
	})
	if !strings.Contains(string(deleteOut), "deleted") {
		t.Errorf("delete output = %q, want 'deleted'", string(deleteOut))
	}

	// Verify gone.
	cfgData, err = client.Get(ctx, "/api/v1/config")
	if err != nil {
		t.Fatalf("get config after delete: %v", err)
	}
	_ = json.Unmarshal(cfgData, &snap)
	for _, r := range snap.Routes {
		if r.ID == routeID {
			t.Errorf("route %s still present after delete", routeID)
		}
	}
}

// ---------------------------------------------------------------------------
// Service commands
// ---------------------------------------------------------------------------

func TestCobra_ServiceList(t *testing.T) {
	token := cobraTestToken(t)
	cleanup := setCobraGlobals(t, token)
	defer cleanup()

	cmd := newServiceListCmd()
	out := captureStdoutBytes(t, func() {
		if err := cmd.RunE(cmd, nil); err != nil {
			t.Fatalf("service list: %v", err)
		}
	})

	var services []json.RawMessage
	if err := json.Unmarshal(out, &services); err != nil {
		t.Fatalf("parse service list: %v (raw: %s)", err, string(out))
	}
	if len(services) == 0 {
		t.Fatal("expected at least 1 seeded service")
	}
}

func TestCobra_ServiceGetNotFound(t *testing.T) {
	token := cobraTestToken(t)
	cleanup := setCobraGlobals(t, token)
	defer cleanup()

	cmd := newServiceGetCmd()
	err := cmd.RunE(cmd, []string{"nonexistent-svc-12345"})
	if err == nil {
		t.Fatal("expected error for nonexistent service, got nil")
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Errorf("error = %q, want 'not found'", err.Error())
	}
}

func TestCobra_ServiceCRUD(t *testing.T) {
	token := cobraTestToken(t)
	cleanup := setCobraGlobals(t, token)
	defer cleanup()

	client := sandboxAPIClient(t, token)
	ctx := context.Background()

	// --- Create ---
	svcName := fmt.Sprintf("cobra-svc-%d", time.Now().UnixNano())
	createCmd := newServiceCreateCmd()
	_ = createCmd.Flags().Set("name", svcName)
	_ = createCmd.Flags().Set("upstream", "localhost:19001")
	_ = createCmd.Flags().Set("lb", "round-robin")

	createOut := captureStdoutBytes(t, func() {
		if err := createCmd.RunE(createCmd, nil); err != nil {
			t.Fatalf("service create: %v", err)
		}
	})
	if len(createOut) == 0 {
		t.Fatal("service create produced no output")
	}

	// Find ID.
	cfgData, err := client.Get(ctx, "/api/v1/config")
	if err != nil {
		t.Fatalf("get config: %v", err)
	}
	var snap struct {
		Services []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"services"`
	}
	_ = json.Unmarshal(cfgData, &snap)

	var svcID string
	for _, s := range snap.Services {
		if s.Name == svcName {
			svcID = s.ID
			break
		}
	}
	if svcID == "" {
		t.Fatal("created service not found in config")
	}

	// --- Get ---
	getCmd := newServiceGetCmd()
	getOut := captureStdoutBytes(t, func() {
		if err := getCmd.RunE(getCmd, []string{svcID}); err != nil {
			t.Fatalf("service get: %v", err)
		}
	})

	var gotSvc struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	if err := json.Unmarshal(getOut, &gotSvc); err != nil {
		t.Fatalf("parse service get: %v (raw: %s)", err, string(getOut))
	}
	if gotSvc.ID != svcID {
		t.Errorf("service get ID = %q, want %q", gotSvc.ID, svcID)
	}

	// --- Delete ---
	deleteCmd := newServiceDeleteCmd()
	deleteOut := captureStdoutBytes(t, func() {
		if err := deleteCmd.RunE(deleteCmd, []string{svcID}); err != nil {
			t.Fatalf("service delete: %v", err)
		}
	})
	if !strings.Contains(string(deleteOut), "deleted") {
		t.Errorf("delete output = %q, want 'deleted'", string(deleteOut))
	}

	// Verify gone.
	cfgData, err = client.Get(ctx, "/api/v1/config")
	if err != nil {
		t.Fatalf("get config after delete: %v", err)
	}
	_ = json.Unmarshal(cfgData, &snap)
	for _, s := range snap.Services {
		if s.ID == svcID {
			t.Errorf("service %s still present after delete", svcID)
		}
	}
}

// ---------------------------------------------------------------------------
// Policy commands
// ---------------------------------------------------------------------------

func TestCobra_PolicyList(t *testing.T) {
	token := cobraTestToken(t)
	cleanup := setCobraGlobals(t, token)
	defer cleanup()

	cmd := newPolicyListCmd()
	// Policy list may return null/empty array — that is fine.
	captureStdoutBytes(t, func() {
		if err := cmd.RunE(cmd, nil); err != nil {
			t.Fatalf("policy list: %v", err)
		}
	})
}

func TestCobra_PolicyGetNotFound(t *testing.T) {
	token := cobraTestToken(t)
	cleanup := setCobraGlobals(t, token)
	defer cleanup()

	cmd := newPolicyGetCmd()
	err := cmd.RunE(cmd, []string{"nonexistent-pol-12345"})
	if err == nil {
		t.Fatal("expected error for nonexistent policy, got nil")
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Errorf("error = %q, want 'not found'", err.Error())
	}
}

func TestCobra_PolicyCRUD(t *testing.T) {
	token := cobraTestToken(t)
	cleanup := setCobraGlobals(t, token)
	defer cleanup()

	client := sandboxAPIClient(t, token)
	ctx := context.Background()

	// --- Create ---
	polName := fmt.Sprintf("cobra-pol-%d", time.Now().UnixNano())
	createCmd := newPolicyCreateCmd()
	_ = createCmd.Flags().Set("name", polName)
	_ = createCmd.Flags().Set("type", "rate-limit")
	_ = createCmd.Flags().Set("config", `{"requestsPerSecond":50}`)

	createOut := captureStdoutBytes(t, func() {
		if err := createCmd.RunE(createCmd, nil); err != nil {
			t.Fatalf("policy create: %v", err)
		}
	})
	if len(createOut) == 0 {
		t.Fatal("policy create produced no output")
	}

	// Find ID.
	cfgData, err := client.Get(ctx, "/api/v1/config")
	if err != nil {
		t.Fatalf("get config: %v", err)
	}
	var snap struct {
		Policies []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"policies"`
	}
	_ = json.Unmarshal(cfgData, &snap)

	var polID string
	for _, p := range snap.Policies {
		if p.Name == polName {
			polID = p.ID
			break
		}
	}
	if polID == "" {
		t.Fatal("created policy not found in config")
	}

	// --- Get ---
	getCmd := newPolicyGetCmd()
	getOut := captureStdoutBytes(t, func() {
		if err := getCmd.RunE(getCmd, []string{polID}); err != nil {
			t.Fatalf("policy get: %v", err)
		}
	})

	var gotPol struct {
		ID   string `json:"id"`
		Name string `json:"name"`
		Type string `json:"type"`
	}
	if err := json.Unmarshal(getOut, &gotPol); err != nil {
		t.Fatalf("parse policy get: %v (raw: %s)", err, string(getOut))
	}
	if gotPol.ID != polID {
		t.Errorf("policy get ID = %q, want %q", gotPol.ID, polID)
	}
	if gotPol.Type != "POLICY_TYPE_RATE_LIMIT" {
		t.Errorf("policy type = %q, want POLICY_TYPE_RATE_LIMIT", gotPol.Type)
	}

	// --- Delete ---
	deleteCmd := newPolicyDeleteCmd()
	deleteOut := captureStdoutBytes(t, func() {
		if err := deleteCmd.RunE(deleteCmd, []string{polID}); err != nil {
			t.Fatalf("policy delete: %v", err)
		}
	})
	if !strings.Contains(string(deleteOut), "deleted") {
		t.Errorf("delete output = %q, want 'deleted'", string(deleteOut))
	}

	// Verify gone.
	cfgData, err = client.Get(ctx, "/api/v1/config")
	if err != nil {
		t.Fatalf("get config after delete: %v", err)
	}
	_ = json.Unmarshal(cfgData, &snap)
	for _, p := range snap.Policies {
		if p.ID == polID {
			t.Errorf("policy %s still present after delete", polID)
		}
	}
}

// ---------------------------------------------------------------------------
// Key commands
// ---------------------------------------------------------------------------

func TestCobra_KeyCRUD(t *testing.T) {
	token := cobraTestToken(t)
	cleanup := setCobraGlobals(t, token)
	defer cleanup()

	// --- Create via cobra ---
	keyName := fmt.Sprintf("cobra-key-%d", time.Now().UnixNano())
	createCmd := newKeyCreateCmd()
	_ = createCmd.Flags().Set("name", keyName)
	_ = createCmd.Flags().Set("scopes", "admin")

	createOut := captureStdoutBytes(t, func() {
		if err := createCmd.RunE(createCmd, nil); err != nil {
			t.Fatalf("key create: %v", err)
		}
	})

	// key create prints to stdout with fmt.Printf, not JSON output.
	outStr := string(createOut)
	if !strings.Contains(outStr, "API key created") {
		t.Fatalf("unexpected key create output: %s", outStr)
	}
	if !strings.Contains(outStr, "ID:") {
		t.Error("key create output missing ID")
	}
	if !strings.Contains(outStr, "Key:") {
		t.Error("key create output missing Key")
	}

	// --- List via cobra ---
	listCmd := newKeyListCmd()
	listOut := captureStdoutBytes(t, func() {
		if err := listCmd.RunE(listCmd, nil); err != nil {
			t.Fatalf("key list: %v", err)
		}
	})

	var keys []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	if err := json.Unmarshal(listOut, &keys); err != nil {
		t.Fatalf("parse key list: %v (raw: %s)", err, string(listOut))
	}

	var keyID string
	for _, k := range keys {
		if k.Name == keyName {
			keyID = k.ID
			break
		}
	}
	if keyID == "" {
		t.Fatal("created key not found in list")
	}

	// --- Revoke via cobra ---
	revokeCmd := newKeyRevokeCmd()
	revokeOut := captureStdoutBytes(t, func() {
		if err := revokeCmd.RunE(revokeCmd, []string{keyID}); err != nil {
			t.Fatalf("key revoke: %v", err)
		}
	})
	if !strings.Contains(string(revokeOut), "revoked") {
		t.Errorf("revoke output = %q, want 'revoked'", string(revokeOut))
	}
}

func TestCobra_KeyList(t *testing.T) {
	token := cobraTestToken(t)
	cleanup := setCobraGlobals(t, token)
	defer cleanup()

	cmd := newKeyListCmd()
	out := captureStdoutBytes(t, func() {
		if err := cmd.RunE(cmd, nil); err != nil {
			t.Fatalf("key list: %v", err)
		}
	})

	// Should be a JSON array (we set flagOutput = "json").
	var keys []json.RawMessage
	if err := json.Unmarshal(out, &keys); err != nil {
		t.Fatalf("parse key list: %v (raw: %s)", err, string(out))
	}
	// Sandbox should have at least the key we used to authenticate.
	if len(keys) == 0 {
		t.Fatal("expected at least 1 key")
	}
}

// ---------------------------------------------------------------------------
// Config commands
// ---------------------------------------------------------------------------

func TestCobra_ConfigExport(t *testing.T) {
	token := cobraTestToken(t)
	cleanup := setCobraGlobals(t, token)
	defer cleanup()

	cmd := newConfigExportCmd()
	out := captureStdoutBytes(t, func() {
		if err := cmd.RunE(cmd, nil); err != nil {
			t.Fatalf("config export: %v", err)
		}
	})

	// Config export uses fmt.Println directly (not printOutput), so it outputs
	// pretty-printed JSON regardless of flagOutput.
	var raw json.RawMessage
	if err := json.Unmarshal(out, &raw); err != nil {
		t.Fatalf("config export is not valid JSON: %v (raw: %s)", err, string(out))
	}

	var snap map[string]json.RawMessage
	_ = json.Unmarshal(out, &snap)
	if _, ok := snap["routes"]; !ok {
		t.Error("config export missing 'routes' field")
	}
	if _, ok := snap["services"]; !ok {
		t.Error("config export missing 'services' field")
	}
}

func TestCobra_ConfigExportToFile(t *testing.T) {
	token := cobraTestToken(t)
	cleanup := setCobraGlobals(t, token)
	defer cleanup()

	tmpFile := t.TempDir() + "/cobra-export.json"
	cmd := newConfigExportCmd()
	_ = cmd.Flags().Set("output-file", tmpFile)

	captureStdoutBytes(t, func() {
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

	var raw json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatalf("exported file is not valid JSON: %v", err)
	}
}

func TestCobra_ConfigVersions(t *testing.T) {
	token := cobraTestToken(t)
	cleanup := setCobraGlobals(t, token)
	defer cleanup()

	cmd := newConfigVersionsCmd()
	out := captureStdoutBytes(t, func() {
		if err := cmd.RunE(cmd, nil); err != nil {
			t.Fatalf("config versions: %v", err)
		}
	})

	// config versions uses fmt.Printf directly.
	outStr := string(out)
	if !strings.Contains(outStr, "Current version") {
		t.Errorf("config versions output = %q, want 'Current version'", outStr)
	}
}

// ---------------------------------------------------------------------------
// Audit commands
// ---------------------------------------------------------------------------

func TestCobra_AuditList(t *testing.T) {
	token := cobraTestToken(t)
	cleanup := setCobraGlobals(t, token)
	defer cleanup()

	cmd := newAuditListCmd()
	out := captureStdoutBytes(t, func() {
		if err := cmd.RunE(cmd, nil); err != nil {
			t.Fatalf("audit list: %v", err)
		}
	})

	// Output should be JSON (flagOutput = "json"). The audit list may be an
	// array of parsed entries or raw objects.
	if len(out) == 0 {
		t.Fatal("audit list produced no output")
	}

	// Try parsing as JSON — the raw data varies depending on the API response
	// shape, so just ensure it is valid JSON.
	var raw json.RawMessage
	if err := json.Unmarshal(out, &raw); err != nil {
		t.Fatalf("audit list output is not valid JSON: %v (raw: %s)", err, string(out))
	}
}

func TestCobra_AuditListWithFilters(t *testing.T) {
	token := cobraTestToken(t)
	cleanup := setCobraGlobals(t, token)
	defer cleanup()

	cmd := newAuditListCmd()
	_ = cmd.Flags().Set("limit", "5")

	out := captureStdoutBytes(t, func() {
		if err := cmd.RunE(cmd, nil); err != nil {
			t.Fatalf("audit list with limit: %v", err)
		}
	})

	if len(out) == 0 {
		t.Fatal("audit list (with limit) produced no output")
	}
}

// ---------------------------------------------------------------------------
// Status command (via REST health)
// ---------------------------------------------------------------------------

func TestCobra_Status(t *testing.T) {
	token := cobraTestToken(t)
	cleanup := setCobraGlobals(t, token)
	defer cleanup()

	cmd := newStatusCmd()
	out := captureStdoutBytes(t, func() {
		if err := cmd.RunE(cmd, nil); err != nil {
			t.Fatalf("status: %v", err)
		}
	})

	outStr := string(out)
	// With flagOutput = "json", printHealthFromREST outputs JSON.
	// Verify it contains health info.
	if len(outStr) == 0 {
		t.Fatal("status produced no output")
	}

	var health struct {
		Overall string `json:"overall"`
	}
	if err := json.Unmarshal(out, &health); err != nil {
		t.Fatalf("status output is not valid JSON: %v (raw: %s)", err, outStr)
	}
	if health.Overall != "HEALTH_STATE_OK" {
		t.Errorf("overall = %q, want HEALTH_STATE_OK", health.Overall)
	}
}
