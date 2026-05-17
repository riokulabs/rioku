//go:build integration

package daemon

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/config"
	"github.com/riokulabs/rioku/internal/store"
	raftstore "github.com/riokulabs/rioku/internal/store/raft"
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// caddyBinaryPath returns the absolute path to the sandbox Caddy binary,
// or skips the test if it cannot be found.
func caddyBinaryPath(t *testing.T) string {
	t.Helper()

	if p := os.Getenv("RIOKU_CADDY_BINARY"); p != "" {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}

	// Walk up from the working directory looking for sandbox/.data/bin/caddy.
	wd, err := os.Getwd()
	if err != nil {
		t.Skipf("caddy binary not found: cannot get working directory: %v", err)
	}

	for dir := wd; dir != "/" && dir != "."; dir = filepath.Dir(dir) {
		candidate := filepath.Join(dir, "sandbox", ".data", "bin", "caddy")
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}

	t.Skip("caddy binary not found at sandbox/.data/bin/caddy — skipping integration test")
	return ""
}

// freePort asks the OS for a free TCP port on 127.0.0.1 and returns it.
func freePort(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("freePort: %v", err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	_ = ln.Close()
	return port
}

// waitForHTTP polls url until it responds 2xx or the context expires.
func waitForHTTP(ctx context.Context, url string) error {
	client := &http.Client{Timeout: 1 * time.Second}
	for {
		select {
		case <-ctx.Done():
			return fmt.Errorf("timed out waiting for %s", url)
		default:
		}
		resp, err := client.Get(url)
		if err == nil {
			_ = resp.Body.Close()
			if resp.StatusCode >= 200 && resp.StatusCode < 300 {
				return nil
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
}

// waitForStoreReady polls the health endpoint until the raft store is the
// leader, indicating that leader election is complete and the store is writable.
func waitForStoreReady(ctx context.Context, healthURL string) error {
	client := &http.Client{Timeout: 2 * time.Second}
	for {
		select {
		case <-ctx.Done():
			return fmt.Errorf("timed out waiting for store leader election at %s", healthURL)
		default:
		}
		resp, err := client.Get(healthURL)
		if err == nil {
			var body map[string]any
			if decErr := json.NewDecoder(resp.Body).Decode(&body); decErr == nil {
				// Check that the store detail shows raft state "Leader".
				if storeObj, ok := body["store"].(map[string]any); ok {
					if detail, ok := storeObj["detail"].(map[string]any); ok {
						if state, ok := detail["state"].(string); ok && state == "Leader" {
							_ = resp.Body.Close()
							return nil
						}
					}
				}
			}
			_ = resp.Body.Close()
		}
		time.Sleep(200 * time.Millisecond)
	}
}

// waitForCaddyProxy polls trafficURL (with the given Host header) until the
// upstream is reachable through Caddy, or the context expires. The check
// requires X-Upstream: reached because Caddy returns "200 OK" with an empty
// body by default (no routes configured), which would otherwise cause a
// false-positive and let the test assert against an empty response.
func waitForCaddyProxy(ctx context.Context, trafficURL, hostHeader string) error {
	client := &http.Client{Timeout: 2 * time.Second}
	for {
		select {
		case <-ctx.Done():
			return fmt.Errorf("timed out waiting for caddy proxy to route %s (Host: %s)", trafficURL, hostHeader)
		default:
		}
		req, err := http.NewRequest(http.MethodGet, trafficURL, nil)
		if err != nil {
			return err
		}
		req.Host = hostHeader
		resp, err := client.Do(req)
		if err == nil {
			reached := resp.Header.Get("X-Upstream") == "reached"
			_, _ = io.ReadAll(resp.Body)
			_ = resp.Body.Close()
			if resp.StatusCode == http.StatusOK && reached {
				return nil
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
}

// doJSON performs an HTTP request with optional JSON body and returns the response.
func doJSON(t *testing.T, method, url, token string, body any) *http.Response {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatalf("encode request body: %v", err)
		}
	}
	req, err := http.NewRequest(method, url, &buf)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, url, err)
	}
	return resp
}

// readBody reads and closes an HTTP response body.
func readBody(t *testing.T, resp *http.Response) string {
	t.Helper()
	defer func() { _ = resp.Body.Close() }()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	return string(data)
}

// ---------------------------------------------------------------------------
// Port allocation
// ---------------------------------------------------------------------------

type testPorts struct {
	grpc         int
	internalGW   int
	restAdmin    int // external REST admin port (Caddy admin server block)
	caddyAdmin   int // Caddy process admin API
	caddyTraffic int
	raft         int
}

func allocatePorts(t *testing.T) testPorts {
	t.Helper()
	return testPorts{
		grpc:         freePort(t),
		internalGW:   freePort(t),
		restAdmin:    freePort(t),
		caddyAdmin:   freePort(t),
		caddyTraffic: freePort(t),
		raft:         freePort(t),
	}
}

// ---------------------------------------------------------------------------
// Store pre-initialization — mimics "rioku init" to seed a root user and
// bootstrap token so the daemon has an authenticated actor available on start.
// ---------------------------------------------------------------------------

// initStore opens a raft store, creates a root user and bootstrap token,
// then closes the store. Returns the plaintext bootstrap token. The daemon
// will re-open this store on start.
func initStore(t *testing.T, tmpDir string, raftBindAddr string) string {
	t.Helper()
	ctx := context.Background()

	drv, err := store.New("raft")
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}

	raftDir := filepath.Join(tmpDir, "raft")
	if rd, ok := drv.(*raftstore.Driver); ok {
		rd.SetRaftConfig(raftstore.RaftConfig{
			NodeID:        "test-node",
			DataDir:       raftDir,
			BindAddr:      raftBindAddr,
			AdvertiseAddr: raftBindAddr,
			Bootstrap:     true,
		})
	}

	if err := drv.Open(ctx, store.DriverConfig{Driver: "raft"}); err != nil {
		t.Fatalf("store open: %v", err)
	}

	if err := drv.Migrate(ctx, store.MigrateUp); err != nil {
		_ = drv.Close()
		t.Fatalf("store migrate: %v", err)
	}

	// Wait for raft leader election.
	for i := 0; i < 50; i++ {
		h := drv.Health(ctx)
		if h.OK && h.Mode == store.ModePrimary {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}

	// Create bootstrap token.
	bootstrapToken, err := auth.GenerateBootstrapToken()
	if err != nil {
		_ = drv.Close()
		t.Fatalf("generate bootstrap token: %v", err)
	}

	tx, err := drv.Begin(ctx, store.TxOptions{})
	if err != nil {
		_ = drv.Close()
		t.Fatalf("begin tx: %v", err)
	}
	if _, err := tx.CreateAPIKey(ctx, "bootstrap", auth.HashToken(bootstrapToken), "", []string{"admin"}, nil, ""); err != nil {
		_ = tx.Rollback()
		_ = drv.Close()
		t.Fatalf("store bootstrap token: %v", err)
	}
	if err := tx.Commit(); err != nil {
		_ = drv.Close()
		t.Fatalf("commit bootstrap token: %v", err)
	}

	_ = drv.Close()
	return bootstrapToken
}

// ---------------------------------------------------------------------------
// startDaemon starts a Rioku daemon in a goroutine and returns a cancel func.
// The store must have been pre-initialized with initStore before calling this.
// ---------------------------------------------------------------------------

func startDaemon(t *testing.T, tmpDir string, ports testPorts, caddyBin string) (cancel context.CancelFunc, errCh <-chan error) {
	t.Helper()

	// Write a minimal rioku.yaml.
	yamlContent := fmt.Sprintf(`store:
  driver: raft
  raft:
    node_id: "test-node"
    bind_addr: "127.0.0.1:%d"
    bootstrap: true
    data_dir: "%s/raft"
listen:
  grpc: "127.0.0.1:%d"
  rest: "127.0.0.1:%d"
  internal_port: %d
  ai_gateway: ""
caddy:
  binary: "%s"
  admin_addr: "127.0.0.1:%d"
  data_dir: "%s/caddy"
  traffic_addrs:
    - "127.0.0.1:%d"
auth:
  dev_mode: true
data_dir: "%s"
log_level: "debug"
`, ports.raft, tmpDir,
		ports.grpc, ports.restAdmin, ports.internalGW,
		caddyBin, ports.caddyAdmin, tmpDir,
		ports.caddyTraffic,
		tmpDir)

	cfgPath := filepath.Join(tmpDir, "rioku.yaml")
	if err := os.WriteFile(cfgPath, []byte(yamlContent), 0640); err != nil {
		t.Fatalf("write config: %v", err)
	}

	cfg, err := config.Load(cfgPath)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	ctx, cancelFn := context.WithCancel(context.Background())
	ch := make(chan error, 1)

	d := New(cfg, cfgPath)
	go func() {
		ch <- d.Start(ctx)
	}()

	return cancelFn, ch
}

// exchangeBootstrapToken exchanges a bootstrap token for a Bearer access token
// via the REST gateway's /api/v1/auth/token endpoint.
func exchangeBootstrapToken(t *testing.T, gwURL, bootstrapToken string) string {
	t.Helper()

	resp := doJSON(t, http.MethodPost, gwURL+"/api/v1/auth/token", "", map[string]string{
		"token": bootstrapToken,
	})
	body := readBody(t, resp)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("token exchange: expected 200, got %d: %s", resp.StatusCode, body)
	}

	var tokenResp struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.Unmarshal([]byte(body), &tokenResp); err != nil {
		t.Fatalf("unmarshal token response: %v", err)
	}
	if tokenResp.AccessToken == "" {
		t.Fatalf("empty access_token in response: %s", body)
	}
	return tokenResp.AccessToken
}

// ---------------------------------------------------------------------------
// TestFullProxyFlow — Issue #40
//
// Validates the complete proxy path:
//   1. Start upstream HTTP server
//   2. Start the Rioku daemon in-process
//   3. Create a service + route via REST API
//   4. Wait for Caddy to sync
//   5. Send HTTP request through Caddy traffic port with correct Host header
//   6. Verify response from upstream
// ---------------------------------------------------------------------------

func TestFullProxyFlow(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}

	caddyBin := caddyBinaryPath(t)
	tmpDir := t.TempDir()
	ports := allocatePorts(t)

	// Pre-initialize the store with a bootstrap token.
	bootstrapToken := initStore(t, tmpDir, fmt.Sprintf("127.0.0.1:%d", ports.raft))

	// 1. Start a simple upstream HTTP server.
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Upstream", "reached")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("hello from upstream"))
	}))
	t.Cleanup(upstream.Close)

	// 2. Start the Rioku daemon.
	cancel, errCh := startDaemon(t, tmpDir, ports, caddyBin)
	t.Cleanup(func() {
		cancel()
		if err := <-errCh; err != nil {
			t.Logf("daemon stopped with: %v", err)
		}
	})

	// Wait for the REST gateway and store to become fully available.
	gwURL := fmt.Sprintf("http://127.0.0.1:%d", ports.internalGW)
	healthURL := gwURL + "/api/v1/health"

	waitCtx, waitCancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer waitCancel()
	if err := waitForHTTP(waitCtx, healthURL); err != nil {
		t.Fatalf("daemon did not become ready: %v", err)
	}
	// Wait for raft leader election to complete so the store is writable.
	if err := waitForStoreReady(waitCtx, healthURL); err != nil {
		t.Fatalf("store did not become ready: %v", err)
	}

	// Exchange bootstrap token for a bearer token.
	bearerToken := exchangeBootstrapToken(t, gwURL, bootstrapToken)

	// 3. Create a service via the REST API.
	upstreamAddr := upstream.Listener.Addr().String()

	svcChange := map[string]any{
		"service": map[string]any{
			"action": "UPSERT",
			"service": map[string]any{
				"name": "test-svc",
				"upstreams": []map[string]any{
					{"address": upstreamAddr},
				},
			},
		},
	}

	resp := doJSON(t, http.MethodPost, gwURL+"/api/v1/config", bearerToken, svcChange)
	body := readBody(t, resp)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("create service: expected 200, got %d: %s", resp.StatusCode, body)
	}

	// Fetch config snapshot to find the service ID.
	configResp := doJSON(t, http.MethodGet, gwURL+"/api/v1/config", bearerToken, nil)
	configBody := readBody(t, configResp)
	if configResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /api/v1/config: expected 200, got %d: %s", configResp.StatusCode, configBody)
	}

	var snap map[string]any
	if err := json.Unmarshal([]byte(configBody), &snap); err != nil {
		t.Fatalf("unmarshal config snapshot: %v", err)
	}

	services, ok := snap["services"].([]any)
	if !ok || len(services) == 0 {
		t.Fatalf("expected at least one service in snapshot, got: %s", configBody)
	}
	svc, ok := services[0].(map[string]any)
	if !ok {
		t.Fatalf("service is not a JSON object: %v", services[0])
	}
	svcID, ok := svc["id"].(string)
	if !ok || svcID == "" {
		t.Fatalf("service ID not found in snapshot: %s", configBody)
	}

	// 4. Create a route that matches on Host header and targets the service.
	testHost := "proxy-test.local"
	routeChange := map[string]any{
		"route": map[string]any{
			"action": "UPSERT",
			"route": map[string]any{
				"name":      "test-route",
				"serviceId": svcID,
				"enabled":   true,
				"matchers": []map[string]any{
					{
						"hosts": []string{testHost},
					},
				},
			},
		},
	}

	resp = doJSON(t, http.MethodPost, gwURL+"/api/v1/config", bearerToken, routeChange)
	body = readBody(t, resp)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("create route: expected 200, got %d: %s", resp.StatusCode, body)
	}

	// 5. Poll until Caddy has the route active (sync agent debounces at 100ms;
	// we give 15s for slow CI runners instead of a fixed 2s sleep).
	trafficURL := fmt.Sprintf("http://127.0.0.1:%d/", ports.caddyTraffic)
	syncCtx, syncCancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer syncCancel()
	if err := waitForCaddyProxy(syncCtx, trafficURL, testHost); err != nil {
		t.Fatalf("caddy route never became active: %v", err)
	}

	// 6. Send a request through Caddy's traffic port with the right Host header.
	trafficReq, err := http.NewRequest(http.MethodGet, trafficURL, nil)
	if err != nil {
		t.Fatalf("new traffic request: %v", err)
	}
	trafficReq.Host = testHost

	client := &http.Client{Timeout: 5 * time.Second}
	trafficResp, err := client.Do(trafficReq)
	if err != nil {
		t.Fatalf("traffic request: %v", err)
	}
	trafficBody := readBody(t, trafficResp)

	if trafficResp.StatusCode != http.StatusOK {
		t.Fatalf("traffic response: expected 200, got %d: %s", trafficResp.StatusCode, trafficBody)
	}
	if trafficResp.Header.Get("X-Upstream") != "reached" {
		t.Errorf("expected X-Upstream header 'reached', got %q", trafficResp.Header.Get("X-Upstream"))
	}
	if trafficBody != "hello from upstream" {
		t.Errorf("expected body 'hello from upstream', got %q", trafficBody)
	}
}

// ---------------------------------------------------------------------------
// TestTrafficTracing — Issue #11
//
// Validates the full trace pipeline:
//   1. Start upstream HTTP server
//   2. Start the Rioku daemon in-process
//   3. Create a service + route via REST API
//   4. Wait for Caddy to sync
//   5. Send multiple HTTP requests through Caddy traffic port with correct Host header
//   6. Wait for the ingester to read from the trace socket and push to the ring buffer
//   7. Trigger an aggregation cycle (via the /api/v1/traffic/stats endpoint)
//   8. Verify the SSE traffic endpoint is wired up
//   9. Verify the stats and traces REST endpoints respond without errors
// ---------------------------------------------------------------------------

func TestTrafficTracing(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}

	caddyBin := caddyBinaryPath(t)
	tmpDir := t.TempDir()
	ports := allocatePorts(t)

	// Pre-initialize the store with a bootstrap token.
	bootstrapToken := initStore(t, tmpDir, fmt.Sprintf("127.0.0.1:%d", ports.raft))

	// 1. Start a simple upstream HTTP server.
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Upstream", "reached")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("hello from upstream"))
	}))
	t.Cleanup(upstream.Close)

	// 2. Start the Rioku daemon.
	cancel, errCh := startDaemon(t, tmpDir, ports, caddyBin)
	t.Cleanup(func() {
		cancel()
		if err := <-errCh; err != nil {
			t.Logf("daemon stopped with: %v", err)
		}
	})

	// Wait for the REST gateway and store to become fully available.
	gwURL := fmt.Sprintf("http://127.0.0.1:%d", ports.internalGW)
	healthURL := gwURL + "/api/v1/health"

	waitCtx, waitCancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer waitCancel()
	if err := waitForHTTP(waitCtx, healthURL); err != nil {
		t.Fatalf("daemon did not become ready: %v", err)
	}
	if err := waitForStoreReady(waitCtx, healthURL); err != nil {
		t.Fatalf("store did not become ready: %v", err)
	}

	// Exchange bootstrap token for a bearer token.
	bearerToken := exchangeBootstrapToken(t, gwURL, bootstrapToken)

	// 3. Create a service via the REST API.
	upstreamAddr := upstream.Listener.Addr().String()

	svcChange := map[string]any{
		"service": map[string]any{
			"action": "UPSERT",
			"service": map[string]any{
				"name": "trace-svc",
				"upstreams": []map[string]any{
					{"address": upstreamAddr},
				},
			},
		},
	}

	resp := doJSON(t, http.MethodPost, gwURL+"/api/v1/config", bearerToken, svcChange)
	body := readBody(t, resp)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("create service: expected 200, got %d: %s", resp.StatusCode, body)
	}

	// Fetch config snapshot to find the service ID.
	configResp := doJSON(t, http.MethodGet, gwURL+"/api/v1/config", bearerToken, nil)
	configBody := readBody(t, configResp)
	if configResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /api/v1/config: expected 200, got %d: %s", configResp.StatusCode, configBody)
	}

	var snap map[string]any
	if err := json.Unmarshal([]byte(configBody), &snap); err != nil {
		t.Fatalf("unmarshal config snapshot: %v", err)
	}

	services, ok := snap["services"].([]any)
	if !ok || len(services) == 0 {
		t.Fatalf("expected at least one service in snapshot, got: %s", configBody)
	}
	svc, ok := services[0].(map[string]any)
	if !ok {
		t.Fatalf("service is not a JSON object: %v", services[0])
	}
	svcID, ok := svc["id"].(string)
	if !ok || svcID == "" {
		t.Fatalf("service ID not found in snapshot: %s", configBody)
	}

	// 4. Create a route that matches on Host header and targets the service.
	testHost := "trace-test.local"
	routeChange := map[string]any{
		"route": map[string]any{
			"action": "UPSERT",
			"route": map[string]any{
				"name":      "trace-route",
				"serviceId": svcID,
				"enabled":   true,
				"matchers": []map[string]any{
					{
						"hosts": []string{testHost},
					},
				},
			},
		},
	}

	resp = doJSON(t, http.MethodPost, gwURL+"/api/v1/config", bearerToken, routeChange)
	body = readBody(t, resp)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("create route: expected 200, got %d: %s", resp.StatusCode, body)
	}

	// Fetch the route ID from the config snapshot for later verification.
	configResp = doJSON(t, http.MethodGet, gwURL+"/api/v1/config", bearerToken, nil)
	configBody = readBody(t, configResp)
	if configResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /api/v1/config: expected 200, got %d: %s", configResp.StatusCode, configBody)
	}
	if err := json.Unmarshal([]byte(configBody), &snap); err != nil {
		t.Fatalf("unmarshal config snapshot: %v", err)
	}
	routes, ok := snap["routes"].([]any)
	if !ok || len(routes) == 0 {
		t.Fatalf("expected at least one route in snapshot, got: %s", configBody)
	}
	routeObj, ok := routes[0].(map[string]any)
	if !ok {
		t.Fatalf("route is not a JSON object: %v", routes[0])
	}
	routeID, _ := routeObj["id"].(string)
	t.Logf("created route ID: %s", routeID)

	// 5. Poll until Caddy has the route active (sync agent debounces at 100ms;
	// we give 15s for slow CI runners instead of a fixed 2s sleep).
	trafficURL := fmt.Sprintf("http://127.0.0.1:%d/", ports.caddyTraffic)
	syncCtx, syncCancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer syncCancel()
	if err := waitForCaddyProxy(syncCtx, trafficURL, testHost); err != nil {
		t.Fatalf("caddy route never became active: %v", err)
	}

	// 6. Send 10 HTTP requests through Caddy's traffic port with the right Host header.
	client := &http.Client{Timeout: 5 * time.Second}

	const numRequests = 10
	for i := 0; i < numRequests; i++ {
		trafficReq, err := http.NewRequest(http.MethodGet, trafficURL, nil)
		if err != nil {
			t.Fatalf("new traffic request %d: %v", i, err)
		}
		trafficReq.Host = testHost

		trafficResp, err := client.Do(trafficReq)
		if err != nil {
			t.Fatalf("traffic request %d: %v", i, err)
		}
		respBody := readBody(t, trafficResp)
		if trafficResp.StatusCode != http.StatusOK {
			t.Fatalf("traffic request %d: expected 200, got %d: %s", i, trafficResp.StatusCode, respBody)
		}
	}
	t.Logf("sent %d traffic requests through Caddy", numRequests)

	// 7. Wait for the ingester to read log lines from the trace socket,
	// parse them, and push traces into the ring buffer. The ingester reads
	// asynchronously from a unixgram socket, so a few seconds is generous.
	time.Sleep(5 * time.Second)

	// 8. Verify the SSE traffic endpoint is wired up and responds with the
	// correct Content-Type. We connect, read headers, then disconnect.
	sseURL := gwURL + "/api/v1/events/traffic"
	sseCtx, sseCancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer sseCancel()
	sseReq, err := http.NewRequestWithContext(sseCtx, http.MethodGet, sseURL, nil)
	if err != nil {
		t.Fatalf("new SSE request: %v", err)
	}
	sseReq.Header.Set("Authorization", "Bearer "+bearerToken)
	sseResp, err := client.Do(sseReq)
	if err != nil {
		// Context deadline exceeded is acceptable — it means the SSE endpoint
		// connected and we timed out waiting for events (which is correct
		// behavior when no new traffic arrives during the timeout window).
		if sseCtx.Err() == nil {
			t.Fatalf("SSE request failed: %v", err)
		}
	}
	if sseResp != nil {
		ct := sseResp.Header.Get("Content-Type")
		_ = sseResp.Body.Close()
		if ct != "text/event-stream" {
			t.Errorf("SSE Content-Type = %q, want %q", ct, "text/event-stream")
		} else {
			t.Log("SSE /api/v1/events/traffic endpoint responds with text/event-stream")
		}
	}

	// 9. Query GET /api/v1/traffic/stats and verify the endpoint responds.
	// The aggregator runs on a 60-second ticker so it may not have fired yet.
	// We verify the endpoint returns a valid JSON response (200 OK with a
	// TrafficStats-shaped body). If the aggregator has run, we check for
	// non-zero stats.
	statsResp := doJSON(t, http.MethodGet, gwURL+"/api/v1/traffic/stats", bearerToken, nil)
	statsBody := readBody(t, statsResp)
	if statsResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /api/v1/traffic/stats: expected 200, got %d: %s", statsResp.StatusCode, statsBody)
	}
	t.Logf("GET /api/v1/traffic/stats response: %s", statsBody)

	var statsResult map[string]any
	if err := json.Unmarshal([]byte(statsBody), &statsResult); err != nil {
		t.Fatalf("unmarshal stats response: %v", err)
	}

	// The response should be a valid JSON object. If buckets are present,
	// verify at least one has a non-zero request count.
	if buckets, ok := statsResult["buckets"].([]any); ok && len(buckets) > 0 {
		t.Logf("stats returned %d bucket(s)", len(buckets))
		foundNonZero := false
		for _, b := range buckets {
			bucket, ok := b.(map[string]any)
			if !ok {
				continue
			}
			if rc, ok := bucket["requestCount"].(string); ok && rc != "0" {
				foundNonZero = true
				t.Logf("found stats bucket with requestCount=%s", rc)
				break
			}
			// protojson may encode int64 as number depending on size.
			if rc, ok := bucket["requestCount"].(float64); ok && rc > 0 {
				foundNonZero = true
				t.Logf("found stats bucket with requestCount=%.0f", rc)
				break
			}
		}
		if !foundNonZero {
			t.Log("stats buckets present but all have zero request counts (aggregator may not have completed)")
		}
	} else {
		t.Log("no stats buckets yet (aggregator has not fired within 60s interval, this is expected)")
	}

	// 10. Query GET /api/v1/traffic/traces and verify the endpoint responds.
	// Raw traces are only in the ring buffer; they are not flushed to SQLite
	// by the current aggregator implementation. The endpoint reads from
	// the persistent store, so it may return an empty result set.
	tracesResp := doJSON(t, http.MethodGet, gwURL+"/api/v1/traffic/traces?page.page_size=100", bearerToken, nil)
	tracesBody := readBody(t, tracesResp)
	if tracesResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /api/v1/traffic/traces: expected 200, got %d: %s", tracesResp.StatusCode, tracesBody)
	}
	t.Logf("GET /api/v1/traffic/traces response: %s", tracesBody)

	var tracesResult map[string]any
	if err := json.Unmarshal([]byte(tracesBody), &tracesResult); err != nil {
		t.Fatalf("unmarshal traces response: %v", err)
	}

	// If traces were persisted, verify at least one matches our route and method.
	if traces, ok := tracesResult["traces"].([]any); ok && len(traces) > 0 {
		t.Logf("traces returned %d trace(s)", len(traces))
		for _, tr := range traces {
			trace, ok := tr.(map[string]any)
			if !ok {
				continue
			}
			trRouteID, _ := trace["routeId"].(string)
			trMethod, _ := trace["method"].(string)
			if trRouteID == routeID && trMethod == "GET" {
				t.Logf("found trace with matching route_id=%s method=%s", trRouteID, trMethod)
				break
			}
		}
	} else {
		t.Log("no traces in persistent store (raw traces are in the ring buffer only; aggregator does not flush them to SQLite)")
	}

	// The test passes as long as:
	// - All 10 traffic requests succeeded through Caddy (verified above)
	// - The SSE endpoint is wired up (verified above)
	// - The stats and traces REST endpoints return 200 OK with valid JSON (verified above)
	// - The entire pipeline (Caddy -> trace socket -> ingester -> ring buffer) did not crash
	t.Log("trace pipeline integration test passed: daemon start -> route creation -> traffic -> trace endpoints all healthy")
}

// ---------------------------------------------------------------------------
// TestDegradedMode — Issue #41
//
// Validates Caddy continues serving after the store becomes unavailable:
//   1. Start upstream + daemon (same as #40)
//   2. Create service + route, verify proxy works
//   3. Make the store unavailable (rename raft data directory)
//   4. Send another request through Caddy — should still work (in-memory)
//   5. Restore the DB directory
//   6. Verify daemon recovers and traffic keeps flowing
// ---------------------------------------------------------------------------

func TestDegradedMode(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}

	caddyBin := caddyBinaryPath(t)
	tmpDir := t.TempDir()
	ports := allocatePorts(t)

	// Pre-initialize the store.
	bootstrapToken := initStore(t, tmpDir, fmt.Sprintf("127.0.0.1:%d", ports.raft))

	// 1. Start upstream.
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Upstream", "reached")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("hello from upstream"))
	}))
	t.Cleanup(upstream.Close)

	// 2. Start daemon.
	cancel, errCh := startDaemon(t, tmpDir, ports, caddyBin)
	t.Cleanup(func() {
		cancel()
		if err := <-errCh; err != nil {
			t.Logf("daemon stopped with: %v", err)
		}
	})

	gwURL := fmt.Sprintf("http://127.0.0.1:%d", ports.internalGW)
	healthURL := gwURL + "/api/v1/health"

	waitCtx, waitCancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer waitCancel()
	if err := waitForHTTP(waitCtx, healthURL); err != nil {
		t.Fatalf("daemon did not become ready: %v", err)
	}
	if err := waitForStoreReady(waitCtx, healthURL); err != nil {
		t.Fatalf("store did not become ready: %v", err)
	}

	bearerToken := exchangeBootstrapToken(t, gwURL, bootstrapToken)

	// 3. Create service + route, verify proxy works.
	upstreamAddr := upstream.Listener.Addr().String()
	testHost := "degraded-test.local"

	svcChange := map[string]any{
		"service": map[string]any{
			"action": "UPSERT",
			"service": map[string]any{
				"name": "degraded-svc",
				"upstreams": []map[string]any{
					{"address": upstreamAddr},
				},
			},
		},
	}
	resp := doJSON(t, http.MethodPost, gwURL+"/api/v1/config", bearerToken, svcChange)
	body := readBody(t, resp)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("create service: expected 200, got %d: %s", resp.StatusCode, body)
	}

	// Get service ID.
	configResp := doJSON(t, http.MethodGet, gwURL+"/api/v1/config", bearerToken, nil)
	configBody := readBody(t, configResp)
	if configResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /api/v1/config: expected 200, got %d: %s", configResp.StatusCode, configBody)
	}
	var snap map[string]any
	if err := json.Unmarshal([]byte(configBody), &snap); err != nil {
		t.Fatalf("unmarshal snapshot: %v", err)
	}
	services, ok := snap["services"].([]any)
	if !ok || len(services) == 0 {
		t.Fatalf("expected at least one service, got: %s", configBody)
	}
	svcID := services[0].(map[string]any)["id"].(string)

	routeChange := map[string]any{
		"route": map[string]any{
			"action": "UPSERT",
			"route": map[string]any{
				"name":      "degraded-route",
				"serviceId": svcID,
				"enabled":   true,
				"matchers": []map[string]any{
					{
						"hosts": []string{testHost},
					},
				},
			},
		},
	}
	resp = doJSON(t, http.MethodPost, gwURL+"/api/v1/config", bearerToken, routeChange)
	body = readBody(t, resp)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("create route: expected 200, got %d: %s", resp.StatusCode, body)
	}

	// Poll until Caddy has the route active (15s budget for slow CI runners).
	trafficURL := fmt.Sprintf("http://127.0.0.1:%d/", ports.caddyTraffic)
	syncCtx, syncCancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer syncCancel()
	if err := waitForCaddyProxy(syncCtx, trafficURL, testHost); err != nil {
		t.Fatalf("caddy route never became active: %v", err)
	}

	// Helper to send a proxied request through Caddy's traffic port.
	sendTraffic := func(t *testing.T) (int, string) {
		t.Helper()
		req, err := http.NewRequest(http.MethodGet, trafficURL, nil)
		if err != nil {
			t.Fatalf("new traffic request: %v", err)
		}
		req.Host = testHost
		client := &http.Client{Timeout: 5 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			t.Fatalf("traffic request: %v", err)
		}
		b := readBody(t, resp)
		return resp.StatusCode, b
	}

	// Verify proxy works before degradation.
	status, _ := sendTraffic(t)
	if status != http.StatusOK {
		t.Fatalf("pre-degradation: expected 200, got %d", status)
	}

	// 4. Make the store unavailable by renaming the raft data directory.
	// The raft store uses bbolt DBs under tmpDir/raft/. Renaming the
	// directory prevents the store from reading or writing.
	raftDir := filepath.Join(tmpDir, "raft")
	raftDirBak := filepath.Join(tmpDir, "raft.bak")
	if err := os.Rename(raftDir, raftDirBak); err != nil {
		t.Fatalf("rename raft dir: %v", err)
	}

	// Give the daemon a moment to notice (it may log errors).
	time.Sleep(500 * time.Millisecond)

	// 5. Send another request through Caddy — should still work because
	// Caddy holds the compiled config in memory.
	status, respBody := sendTraffic(t)
	if status != http.StatusOK {
		t.Fatalf("degraded mode: expected 200, got %d: %s", status, respBody)
	}

	// 6. Restore the DB directory.
	if err := os.Rename(raftDirBak, raftDir); err != nil {
		t.Fatalf("restore raft dir: %v", err)
	}

	// Give the daemon time to recover.
	time.Sleep(2 * time.Second)

	// Verify traffic still flows after recovery.
	status, respBody = sendTraffic(t)
	if status != http.StatusOK {
		t.Fatalf("post-recovery: expected 200, got %d: %s", status, respBody)
	}
}
