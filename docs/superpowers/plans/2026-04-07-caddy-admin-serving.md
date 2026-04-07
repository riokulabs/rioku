# Caddy Admin Serving — Implementation Plan

> **Plan 3 of 5 — Auth Security Overhaul**
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route the admin panel and REST API through Caddy for auto-TLS, complete network isolation from user traffic, and proper HTTPS. The Go `net/http` gateway becomes an internal loopback-only process; all external access goes through a dedicated Caddy server block.

**Architecture:** The Caddy compiler produces two server blocks: `traffic` (user-defined routes, `:443`) and `admin` (reverse proxy to internal Go gateway, `:7778` by default or a dedicated domain). The Go gateway binds to `127.0.0.1:0` and exposes the OS-assigned port so the compiler can build the upstream address. The daemon wires these together at startup.

```
External:
  Browser/CLI → Caddy admin block (:7778 or admin_domain:443) → 127.0.0.1:<internal> → Go net/http
  Traffic      → Caddy traffic block (:443)                    → user-defined upstreams

Internal only (never network-exposed):
  127.0.0.1:<internal> — Go net/http (REST API + admin SPA)
  :7777                — Go gRPC (mTLS, node-to-node)
```

**Tech Stack:** Go stdlib `net`, `net/http`, `fmt`. No new dependencies.

**Spec:** `contrib-docs/design/auth-security-overhaul.md` (Part 8: Admin Serving via Caddy)

---

## Task 1: Add `AdminConfig` to the Caddy compiler and produce two server blocks

**Files:**
- Modify: `packages/daemon/internal/caddy/compiler.go`
- Modify: `packages/daemon/internal/caddy/compiler_test.go`

This is the core change. The compiler gains an `AdminConfig` that carries the internal port and optional admin domain. `Compile` produces `traffic` and `admin` server blocks instead of the single `rioku` block.

### AdminConfig shape

```go
// AdminConfig controls how the admin server block is compiled.
type AdminConfig struct {
    // InternalAddr is the loopback address the Go net/http gateway is bound to,
    // e.g. "127.0.0.1:54321". The compiler uses this as the reverse_proxy upstream.
    InternalAddr string

    // ListenAddr is the external address Caddy listens on for admin traffic.
    // Defaults to ":7778" when empty.
    ListenAddr string

    // Domain is the optional dedicated admin domain (e.g. "admin.example.com").
    // When set, the admin server listens on ":443" and Caddy provisions auto-TLS.
    // Mutually exclusive with ListenAddr for port-based serving.
    Domain string

    // DevMode disables TLS on the admin block (HTTP only).
    DevMode bool
}
```

### Compiler struct changes

Replace `listenAddrs []string` with explicit fields:

```go
type Compiler struct {
    trafficAddrs []string
    admin        AdminConfig
}

func NewCompiler(trafficAddrs []string, admin AdminConfig) *Compiler {
    addrs := make([]string, len(trafficAddrs))
    copy(addrs, trafficAddrs)
    return &Compiler{trafficAddrs: addrs, admin: admin}
}
```

### Compile output

```go
func (c *Compiler) Compile(snapshot *riokuv1.ConfigSnapshot) ([]byte, error) {
    // ... build caddyRoutes as before ...

    servers := map[string]any{
        "traffic": map[string]any{
            "listen": c.trafficAddrs,
            "routes": caddyRoutes,
        },
    }

    if c.admin.InternalAddr != "" {
        servers["admin"] = c.buildAdminServer()
    }

    config := map[string]any{
        "apps": map[string]any{
            "http": map[string]any{
                "servers": servers,
            },
        },
    }
    return json.Marshal(config)
}

func (c *Compiler) buildAdminServer() map[string]any {
    listenAddr := c.admin.ListenAddr
    if listenAddr == "" {
        listenAddr = ":7778"
    }

    // Domain overrides port-based listening.
    if c.admin.Domain != "" {
        listenAddr = ":443"
    }

    server := map[string]any{
        "listen": []string{listenAddr},
        "routes": []map[string]any{
            {
                "handle": []map[string]any{
                    {
                        "handler": "reverse_proxy",
                        "upstreams": []map[string]any{
                            {"dial": c.admin.InternalAddr},
                        },
                    },
                },
            },
        },
    }

    // Add host matcher when a dedicated domain is configured.
    if c.admin.Domain != "" {
        server["routes"].([]map[string]any)[0]["match"] = []map[string]any{
            {"host": []string{c.admin.Domain}},
        }
        // TLS connection policy enables auto-TLS for the domain.
        if !c.admin.DevMode {
            server["tls_connection_policies"] = []map[string]any{{}}
        }
    }

    // Dev mode: no TLS connection policy → plain HTTP.
    // Non-dev, port-based (no domain): Caddy will use its default TLS behavior
    // for the configured listen address, which for :7778 means auto-TLS if
    // a domain resolves to this host, or plain HTTP for localhost.

    return server
}
```

### Steps

- [ ] **Step 1: Write failing tests for the new two-server-block output**

Add to `compiler_test.go`:

```go
func TestCompileTwoServerBlocks(t *testing.T) {
    c := NewCompiler([]string{":443"}, AdminConfig{
        InternalAddr: "127.0.0.1:54321",
        ListenAddr:   ":7778",
    })

    data, err := c.Compile(&riokuv1.ConfigSnapshot{})
    if err != nil {
        t.Fatalf("Compile: %v", err)
    }

    var cfg map[string]any
    if err := json.Unmarshal(data, &cfg); err != nil {
        t.Fatalf("unmarshal: %v", err)
    }

    servers := dig(t, cfg, "apps", "http", "servers")

    // traffic block
    traffic := servers["traffic"].(map[string]any)
    tListen := traffic["listen"].([]any)
    if len(tListen) != 1 || tListen[0].(string) != ":443" {
        t.Errorf("traffic listen = %v, want [:443]", tListen)
    }

    // admin block
    admin, ok := servers["admin"].(map[string]any)
    if !ok {
        t.Fatal("admin server block missing")
    }
    aListen := admin["listen"].([]any)
    if len(aListen) != 1 || aListen[0].(string) != ":7778" {
        t.Errorf("admin listen = %v, want [:7778]", aListen)
    }

    routes := admin["routes"].([]any)
    if len(routes) != 1 {
        t.Fatalf("admin routes: expected 1, got %d", len(routes))
    }
    handlers := routes[0].(map[string]any)["handle"].([]any)
    h := handlers[0].(map[string]any)
    if h["handler"].(string) != "reverse_proxy" {
        t.Errorf("admin handler = %v, want reverse_proxy", h["handler"])
    }
    upstreams := h["upstreams"].([]any)
    if upstreams[0].(map[string]any)["dial"].(string) != "127.0.0.1:54321" {
        t.Errorf("admin upstream dial = %v, want 127.0.0.1:54321", upstreams[0])
    }
}

func TestCompileAdminDomain(t *testing.T) {
    c := NewCompiler([]string{":443"}, AdminConfig{
        InternalAddr: "127.0.0.1:54321",
        Domain:       "admin.example.com",
    })

    data, err := c.Compile(&riokuv1.ConfigSnapshot{})
    if err != nil {
        t.Fatalf("Compile: %v", err)
    }

    var cfg map[string]any
    if err := json.Unmarshal(data, &cfg); err != nil {
        t.Fatalf("unmarshal: %v", err)
    }

    servers := dig(t, cfg, "apps", "http", "servers")
    admin := servers["admin"].(map[string]any)

    // Domain mode listens on :443.
    aListen := admin["listen"].([]any)
    if aListen[0].(string) != ":443" {
        t.Errorf("admin domain listen = %v, want :443", aListen)
    }

    // Host matcher present.
    route := admin["routes"].([]any)[0].(map[string]any)
    match := route["match"].([]any)[0].(map[string]any)
    hosts := match["host"].([]any)
    if hosts[0].(string) != "admin.example.com" {
        t.Errorf("admin domain host = %v, want admin.example.com", hosts[0])
    }

    // TLS connection policies present.
    if _, ok := admin["tls_connection_policies"]; !ok {
        t.Error("admin domain block missing tls_connection_policies")
    }
}

func TestCompileAdminDevMode(t *testing.T) {
    c := NewCompiler([]string{":443"}, AdminConfig{
        InternalAddr: "127.0.0.1:54321",
        DevMode:      true,
    })

    data, err := c.Compile(&riokuv1.ConfigSnapshot{})
    if err != nil {
        t.Fatalf("Compile: %v", err)
    }

    var cfg map[string]any
    if err := json.Unmarshal(data, &cfg); err != nil {
        t.Fatalf("unmarshal: %v", err)
    }

    servers := dig(t, cfg, "apps", "http", "servers")
    admin := servers["admin"].(map[string]any)

    // Dev mode: no TLS connection policies.
    if _, ok := admin["tls_connection_policies"]; ok {
        t.Error("dev mode admin block should not have tls_connection_policies")
    }
}

func TestCompileNoAdminBlock(t *testing.T) {
    // Zero AdminConfig (no InternalAddr) → no admin server block.
    c := NewCompiler([]string{":443"}, AdminConfig{})

    data, err := c.Compile(&riokuv1.ConfigSnapshot{})
    if err != nil {
        t.Fatalf("Compile: %v", err)
    }

    var cfg map[string]any
    if err := json.Unmarshal(data, &cfg); err != nil {
        t.Fatalf("unmarshal: %v", err)
    }

    servers := dig(t, cfg, "apps", "http", "servers")
    if _, ok := servers["admin"]; ok {
        t.Error("expected no admin block when InternalAddr is empty")
    }
    if _, ok := servers["traffic"]; !ok {
        t.Error("expected traffic block to exist")
    }
}
```

- [ ] **Step 2: Update existing compiler tests**

Existing tests reference `NewCompiler(":443", ":80")` and navigate `servers["rioku"]`. Update all calls to use `NewCompiler([]string{":443", ":80"}, AdminConfig{})` and navigate `servers["traffic"]` instead of `servers["rioku"]`.

The `dig` helper remains unchanged.

- [ ] **Step 3: Implement changes in `compiler.go`**

Add the `AdminConfig` struct, update `Compiler`, `NewCompiler`, `Compile`, and add `buildAdminServer`. Remove the old `listenAddrs` field. The server block key changes from `"rioku"` to `"traffic"`.

- [ ] **Step 4: Run tests**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && \
  go test -race ./internal/caddy/... -v
```

All existing tests must pass (updated server key) and all new tests must pass.

---

## Task 2: Bind gateway to `127.0.0.1:0` and expose assigned port

**Files:**
- Modify: `packages/daemon/internal/gateway/gateway.go`

The gateway currently accepts an `addr string` and binds via `ListenAndServe`. Change it to:

1. Accept `"127.0.0.1:0"` as the bind address (caller always passes this).
2. Pre-create the `net.Listener` before `NewGateway` returns so the OS-assigned port is known immediately.
3. Expose `Addr() string` so the daemon can read `"127.0.0.1:<port>"` and hand it to the compiler.
4. `Start()` calls `Serve(listener)` instead of `ListenAndServe()`.

### Gateway struct changes

```go
type Gateway struct {
    httpServer *http.Server
    listener   net.Listener
    addr       string // the resolved address, e.g. "127.0.0.1:54321"
}

// NewGateway creates the gateway and opens the listener immediately.
// Pass addr as "127.0.0.1:0" to get an OS-assigned port.
func NewGateway(
    addr string,
    configSvc riokuv1.ConfigServiceServer,
    healthSvc riokuv1.HealthServiceServer,
    a *auth.Auth,
    engine *config.Engine,
    st store.Driver,
    spaFS fs.FS,
) (*Gateway, error) {
    // ... (handler setup unchanged) ...

    ln, err := net.Listen("tcp", addr)
    if err != nil {
        return nil, fmt.Errorf("gateway: listen %s: %w", addr, err)
    }

    return &Gateway{
        httpServer: &http.Server{
            Handler:      handler,
            ReadTimeout:  15 * time.Second,
            WriteTimeout: 60 * time.Second,
            IdleTimeout:  120 * time.Second,
        },
        listener: ln,
        addr:     ln.Addr().String(),
    }, nil
}

// Addr returns the resolved listen address (e.g. "127.0.0.1:54321").
// Safe to call immediately after NewGateway.
func (g *Gateway) Addr() string {
    return g.addr
}

// Start begins serving HTTP requests. Blocks until Stop is called.
func (g *Gateway) Start() error {
    log.Printf("rest: internal gateway listening on %s", g.addr)
    err := g.httpServer.Serve(g.listener)
    if err == http.ErrServerClosed {
        return nil
    }
    return err
}
```

The `Stop` method is unchanged.

### Steps

- [ ] **Step 1: Write a test for loopback-only binding and port exposure**

Add to a new file `packages/daemon/internal/gateway/gateway_test.go` (or alongside existing tests if the file exists):

```go
func TestGatewayBindsLoopbackOnly(t *testing.T) {
    gw, err := NewGateway("127.0.0.1:0", nil, nil, nil, nil, nil, nil)
    if err != nil {
        t.Fatalf("NewGateway: %v", err)
    }
    defer gw.Stop(context.Background())

    addr := gw.Addr()
    if !strings.HasPrefix(addr, "127.0.0.1:") {
        t.Errorf("Addr() = %q, want 127.0.0.1:<port>", addr)
    }

    // Port must be non-zero.
    _, portStr, err := net.SplitHostPort(addr)
    if err != nil {
        t.Fatalf("SplitHostPort(%q): %v", addr, err)
    }
    port, err := strconv.Atoi(portStr)
    if err != nil || port == 0 {
        t.Errorf("expected non-zero port, got %q", portStr)
    }
}
```

Note: `NewGateway` with nil service args will require either nil-safe guards in the constructor or a test double. Adjust the test to pass minimal stubs if the constructor calls methods on service args during setup.

- [ ] **Step 2: Implement changes in `gateway.go`**

Add `net` import. Change `httpServer` init to omit `Addr` field. Add `listener` field and `Addr()` method. Change `Start()` to call `Serve`. Pre-open the listener in `NewGateway`.

- [ ] **Step 3: Run gateway tests**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && \
  go test -race ./internal/gateway/... -v
```

---

## Task 3: Add `AdminDomain` to config and wire the internal port in the daemon

**Files:**
- Modify: `packages/daemon/internal/config/file.go`
- Modify: `packages/daemon/internal/daemon/daemon.go`

### Config change

Add `AdminDomain` to `ListenConfig`:

```go
type ListenConfig struct {
    GRPC        string `yaml:"grpc"`
    REST        string `yaml:"rest"`
    AdminDomain string `yaml:"admin_domain"` // optional; dedicated domain for admin with auto-TLS
}
```

No default value needed — empty string means "use REST port".

### Daemon wiring

Current flow (daemon.go, around line 82):
```go
compiler := caddy.NewCompiler()
```

New flow:

```go
// Compiler is created with traffic addresses only at this point.
// The admin config is filled in after the gateway is started (port unknown until then).
// A placeholder compiler is used for the initial engine; it is replaced before the
// first sync push to Caddy.
```

The daemon needs to:

1. Start the gateway on `127.0.0.1:0` before building the final compiler.
2. Read `gw.Addr()` to get the internal address.
3. Build the `AdminConfig` from `cfg.Listen`.
4. Pass the complete compiler (with `AdminConfig`) to the config engine **or** update the compiler on the engine before the first sync.

The cleanest approach given the current architecture: create a two-phase init where the compiler is constructed with a zero `AdminConfig` initially, then replaced after the gateway binds.

Check whether `config.Engine` exposes a method to swap the compiler. If not, add `SetCompiler(caddy.Compiler)` to the engine interface or pass the compiler as a pointer.

Alternatively — and simpler — restructure the daemon startup to start the gateway first, before creating the compiler and engine, since the gateway does not depend on the engine for its own construction.

**Recommended order in `daemon.go`:**

```
1. Open store
2. Run migrations
3. Create auth
4. Start Caddy child process
5. Start gateway on 127.0.0.1:0  ← moved up, before compiler
6. Build AdminConfig from cfg + gateway.Addr()
7. Create compiler with AdminConfig
8. Create config engine with compiler
9. Start sync agent
10. Start gRPC server
11. go gateway.Start()            ← Start serving (listener already open)
12. Write PID file
```

The gateway listener is already open after `NewGateway`, so `Start()` can be called later. The port is available as soon as `NewGateway` returns.

### Daemon code

```go
// 5. Start gateway on localhost (port assigned by OS).
spaFS, err := riokuweb.SPA()
if err != nil {
    log.Printf("web: admin panel not available: %v", err)
}

var gw *gateway.Gateway
// Gateway requires gRPC services; defer actual Start until after gRPC is up.
// But we CAN open the listener early to learn the port.
internalListener, internalAddr, err := openLoopbackListener()
if err != nil {
    log.Printf("rest: failed to open internal listener: %v", err)
}

// 6. Build admin config.
adminListenAddr := cfg.Listen.REST
if adminListenAddr == "" {
    adminListenAddr = ":7778"
}
adminCfg := caddy.AdminConfig{
    InternalAddr: internalAddr,
    ListenAddr:   adminListenAddr,
    Domain:       cfg.Listen.AdminDomain,
    DevMode:      devMode, // passed into daemon or read from cfg
}

// 7. Create compiler with both traffic and admin config.
trafficAddrs := []string{":443"}
compiler := caddy.NewCompiler(trafficAddrs, adminCfg)
```

Where `openLoopbackListener` is a small helper:

```go
func openLoopbackListener() (net.Listener, string, error) {
    ln, err := net.Listen("tcp", "127.0.0.1:0")
    if err != nil {
        return nil, "", err
    }
    return ln, ln.Addr().String(), nil
}
```

The listener is then passed into `NewGateway` instead of an address string (requires a small `NewGatewayFromListener` variant, or the gateway accepts a `net.Listener` directly — see Task 2 for the interface).

**Simpler alternative:** `NewGateway("127.0.0.1:0", ...)` opens the listener internally and exposes `Addr()`. The daemon calls `NewGateway` in step 5, reads `gw.Addr()` in step 6, builds the compiler in step 7. The gateway's `Start()` is still called in a goroutine after gRPC services are ready (step 11). The listener is held open inside the gateway between `NewGateway` and `Start()`.

This is the approach used in Task 2 above — it is self-contained and requires no changes to how the gateway is called beyond the address change.

### Steps

- [ ] **Step 1: Add `AdminDomain` to `ListenConfig` in `file.go`**

No validation change needed — empty string is valid (means "use REST port").

- [ ] **Step 2: Restructure daemon startup order in `daemon.go`**

Move gateway construction before compiler creation. Update the compiler call to pass `[]string{":443"}` and an `AdminConfig` built from `cfg.Listen` and `gw.Addr()`.

The daemon currently reads `cfg.Listen.REST` as the address to pass to the gateway. After this change, the REST config value becomes the **Caddy-facing** listen address, not the internal Go bind address. The internal address is always `127.0.0.1:0`.

Log line example:
```
rest: internal gateway bound to 127.0.0.1:54321
caddy: admin server will proxy to 127.0.0.1:54321 on :7778
```

- [ ] **Step 3: Run full daemon build**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && \
  make build-daemon 2>&1 | head -40
```

(Or `go build ./...` if Make is not available in the agent context.)

- [ ] **Step 4: Smoke test via sandbox**

```bash
make sandbox
curl -s http://localhost:7778/api/v1/health | jq .
```

The health endpoint must return 200. Confirm via `ss -tlnp` or `netstat` that nothing is listening on `:7778` from the Go process directly — only Caddy should own that port.

---

## Task 4: Update existing compiler tests for renamed server key

This is already covered in Task 1 Step 2, but listed separately for clarity since it touches every existing test assertion against `servers["rioku"]`.

**Files:**
- Modify: `packages/daemon/internal/caddy/compiler_test.go`

- [ ] **Step 1: Find all references to `"rioku"` server key in test file**

```bash
grep -n '"rioku"' packages/daemon/internal/caddy/compiler_test.go
```

- [ ] **Step 2: Replace `servers["rioku"]` with `servers["traffic"]`**

Also update the `dig(t, cfg, "apps", "http", "servers", "rioku")` call pattern to `dig(t, cfg, "apps", "http", "servers", "traffic")`.

- [ ] **Step 3: Run full test suite**

```bash
cd /home/dmehaffy/Documents/RiokuLabs/rioku/packages/daemon && \
  go test -race ./... 2>&1
```

Zero failures expected.

---

## Acceptance Criteria

- [ ] `go test -race ./internal/caddy/...` passes — two-server-block output verified, admin block present/absent correctly, domain mode adds host matcher and TLS policies, dev mode omits TLS policies.
- [ ] `go test -race ./internal/gateway/...` passes — gateway binds to `127.0.0.1` only, `Addr()` returns a non-zero loopback port.
- [ ] `go build ./...` compiles clean with no unused imports or type errors.
- [ ] `make sandbox` + `curl localhost:7778/api/v1/health` returns 200.
- [ ] `ss -tlnp` shows Caddy (not `rioku`) owning `:7778`.
- [ ] No user-defined route can shadow admin routes (verified by separate server blocks in compiled Caddy JSON).

---

## Commit Sequence

```
test(caddy): add two-server-block compiler tests
refactor(caddy): produce traffic and admin server blocks
test(gateway): verify loopback-only binding and Addr exposure
refactor(gateway): bind to 127.0.0.1:0, expose assigned port via Addr()
feat(config): add listen.admin_domain option
refactor(daemon): wire internal gateway port into Caddy admin server block
```

Each commit should be independently buildable. Run `go test -race ./...` before each commit.
