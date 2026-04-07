# Rioku — Architecture Design Document

**Version:** 0.3
**Status:** Pre-implementation / Architecture
**Last Updated:** 2026-04-02
**Supersedes:** Design Doc v0.2

---

## 2. Process Topology

### 2.1 What Runs

```
┌─────────────────────────────────────────────────────────┐
│  rioku daemon (single Go binary)                        │
│                          │                              │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐
│  │ gRPC server      │  │ REST gateway     │  │ Config engine        │
│  │ (internal)       │  │ (external)       │  │ + sync loop          │
│  └──────────────────┘  └──────────────────┘  └──────────────────────┘
│                          │                              │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐
│  │ Plugin host      │  │ Build mgr        │  │ Cluster agent        │
│  │                  │  │ (xcaddy)         │  │ (multi-node)         │
│  └──────────────────┘  └──────────────────┘  └──────────────────────┘
└─────────────────────────────────────────────────────────┘

┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│  Caddy process   │    │  SQLite/PG/      │    │  Valkey          │
│  (child, mgd)    │    │  MariaDB         │    │  (optional       │
│                  │    │  (config         │    │  module)         │
│                  │    │  store)          │    │                  │
└──────────────────┘    └──────────────────┘    └──────────────────┘

┌─────────────────────────────────────────────────────────┐
│  Admin SPA (SvelteKit, go:embed into daemon binary)     │
│  Served by the daemon REST gateway — no separate        │
│  web server process                                     │
└─────────────────────────────────────────────────────────┘

┌────────────────────────────┐
│  Build Service (separate binary,    │
│  self-hostable, optional)           │
│  xcaddy + Go toolchain              │
└────────────────────────────┘
```

### 2.2 Key Topology Decisions

- **Caddy runs as a child process managed by the daemon.** The daemon owns Caddy's full lifecycle — start, stop, hot-swap on rebuild. This is required for zero-downtime binary replacement.
- **The daemon serves the SPA static files directly** via `go:embed`. No separate web server.
- **Redis/Valkey is optional at the process level.** If the module is not loaded, no connection is attempted. Use Valkey (Linux Foundation Redis fork, SSPL-free, drop-in compatible).
- **Single binary vs two binaries:** One binary (`rioku`) with subcommand detection. `rku` is a symlink or shell alias pointing at the same binary. `cobra` makes this the natural choice.

---

## 3. Internal gRPC API

### 3.1 Transport

- **gRPC internally** (node <-> node only)
- **REST for all clients** (CLI, admin panel, operator tooling) via `grpc-gateway` generating REST from proto annotations — eliminates duplication
- The CLI communicates with the daemon over REST (not gRPC). Same binary works locally (`http://localhost:7778`) or remotely (`https://gateway.prod.internal:7778`). This matches the industry pattern (kubectl, vault, consul all use REST)
- **SSE** for live event streams (translated from gRPC server-streaming RPCs at the REST gateway layer)

Ports (configurable):
- gRPC: `:7777` (internal only, mTLS required)
- REST: `:7778` (external, TLS via Caddy or daemon)

### 3.2 Service Definitions

```protobuf
service ConfigService {
  rpc GetConfig(GetConfigRequest) returns (ConfigSnapshot);
  rpc ApplyChange(ConfigChange) returns (ApplyResult);
  rpc WatchChanges(WatchRequest) returns (stream ConfigEvent);
  rpc GetAuditLog(AuditQuery) returns (stream AuditEntry);
  rpc ExportConfig(ExportRequest) returns (stream ConfigChunk);
  rpc ImportConfig(stream ConfigChunk) returns (ImportResult);
}


service PluginService {
  rpc ListPlugins(ListPluginsRequest) returns (PluginList);
  rpc InstallPlugin(InstallRequest) returns (stream InstallEvent);
  rpc RemovePlugin(RemoveRequest) returns (RemoveResult);
  rpc GetPluginConfig(PluginConfigRequest) returns (PluginConfig);
  rpc SetPluginConfig(SetPluginConfigRequest) returns (SetResult);
}


service BuildService {
  rpc TriggerBuild(BuildRequest) returns (stream BuildEvent);
  rpc GetBuildStatus(BuildStatusRequest) returns (BuildStatus);
  rpc SwapBinary(SwapRequest) returns (SwapResult);
}


service ClusterService {
  rpc Join(JoinRequest) returns (JoinResult);
  rpc Leave(LeaveRequest) returns (LeaveResult);
  rpc ListNodes(ListNodesRequest) returns (NodeList);
  rpc SyncState(SyncRequest) returns (SyncResult);
  rpc WatchCluster(WatchRequest) returns (stream ClusterEvent);
}


service HealthService {
  rpc GetHealth(HealthRequest) returns (HealthStatus);
  rpc GetCaddyStatus(CaddyStatusRequest) returns (CaddyStatus);
}
```

Notes:
- `WatchChanges` and `WatchCluster` are server-streaming RPCs -> translated to SSE at the REST layer for the admin SPA.
- `InstallPlugin` and `TriggerBuild` stream progress events — these are long-running operations and the CLI must show live output.
- The CLI communicates with the daemon **exclusively** over REST. It never touches the config store directly. Node-local commands (init, start, stop, migrate) are the only exceptions — they access local filesystem and processes.

### 3.3 Node-to-Node mTLS

The gRPC server is internal but multi-node deployments require nodes to reach each other's gRPC ports. mTLS between nodes is **day-one required**, not deferrable. The daemon generates and rotates its own node certificates via the internal CA (see Section 7). This is not a "service mesh feature" — it is basic cluster security.

---

## 4. External REST API

The REST gateway is a **thin translation layer only** — no business logic lives here. Translates HTTP+JSON -> gRPC, and gRPC streams -> SSE.

### 4.1 Resource Model

```
/api/v1/
  routes/           # proxy routes and upstreams
  plugins/           # installed plugins, their configs
  services/            # upstream service definitions
  policies/          # attached policies (rate limit, auth, etc.)
  keys/              # API key management
  audit/             # audit log (read-only)
  cluster/           # node management
  health/            # health + Caddy status
  build/             # build status and history
  config/
    export           # POST -> download config bundle
    import           # POST -> upload config bundle
    migrate          # POST -> trigger store migration
```

### 4.2 SSE Endpoints

```
GET /api/v1/events/config    # live config change stream
GET /api/v1/events/cluster   # live cluster state stream
GET /api/v1/events/build     # live build progress stream
```

### 4.3 Auth

Bearer token, issued by the daemon's own bootstrap auth (first-party JWT, no external dependency). See Section 6.

---

## 5. Config Store

### 5.1 Driver Abstraction

The config engine never talks to a database directly. All access goes through the `StoreDriver` interface:

```go
type Driver interface {
    Open(ctx context.Context, cfg DriverConfig) error
    Close() error
    Ping(ctx context.Context) error
    Migrate(ctx context.Context, direction MigrateDirection) error
    CurrentVersion(ctx context.Context) (int, error)
    Begin(ctx context.Context, opts TxOptions) (Tx, error)
    Notify() <-chan ChangeEvent
    Health(ctx context.Context) DriverHealth
}

type DriverHealth struct {
    OK      bool
    Mode    DriverMode
    Details map[string]string  // backend-specific: wsrep_*, pg replication lag, etc.
}

type DriverMode int
const (
    ModeSingle    DriverMode = iota  // SQLite
    ModePrimary                      // Postgres primary, Galera full member
    ModeReplica                      // Postgres replica (read-only)
    ModeDonor                        // Galera donor (avoid for writes)
    ModeDesync                       // Galera desynced (avoid entirely)
    ModeDegraded                     // quorum lost or unhealthy
)
```

Three concrete implementations: `sqliteDriver`, `postgresDriver`, `mysqlDriver`. None exposed outside the `store` package.

### 5.2 Schema

```sql
-- Core entities
routes          -- route definitions, upstream targets, matchers
services        -- upstream service registry
plugins         -- installed plugins + their active config
policies        -- policy definitions (rate limit rules, auth rules, etc.)
policy_bindings -- many-to-many: policy attached to route/service

-- Identity
api_keys        -- hashed keys, scoped permissions, expiry
agent_identities -- AI agent identities (Phase 5, schema reserved)

-- Ops
config_versions  -- full snapshots on every change (for rollback)
audit_log        -- actor, timestamp, operation, diff (append-only)
cluster_nodes    -- node registry for multi-node deployments
build_history    -- xcaddy build records, artifact hashes

-- Migrations
schema_versions  -- standard migration table

-- MySQL/MariaDB only
config_changes   -- polling-based change notification (see 5.5)
```

### 5.3 Deployment Recommendations

| Deployment | Store | Rationale |
|---|---|---|
| Single node, dev/small prod | SQLite | Zero ops, embedded, no external process |
| Small cluster (2-5 nodes) | Postgres (primary + replicas) | Simple HA, streaming replication |
| Large cluster / HA | MariaDB Galera (3+ nodes) | Multi-master, no write single point of failure |
| Galera minimum viable | 3 nodes | Quorum requires odd number; 2-node is an anti-pattern |

**Important:** Rioku's config store sees low write volume (gateway config, not request logs). Galera is chosen for **correctness** (no split-brain on config changes) not write throughput. Document this clearly so operators don't think Galera is needed for high traffic.

### 5.4 Galera-Specific Architecture

#### 5.4.1 Multi-Master Write Conflicts

Galera uses optimistic concurrency with certification-based conflict detection. Two nodes can accept the same write simultaneously; one will be rolled back at commit time with `ER_LOCK_DEADLOCK` (error 1213). This is a Galera certification failure, not a real deadlock — they share the same error code.

The MySQL driver must:
- Detect error 1213 on commit
- Distinguish certification failure from real deadlock (check `wsrep_last_committed` progression)
- Retry the transaction automatically with exponential backoff, bounded retries (configurable, default: 3)
- Expose certification conflict rate as a health metric

#### 5.4.2 Node State Machine

Every Galera node has `wsrep_local_state`:
```
JOINING(1)  -> DONOR/DESYNCED(2)  -> JOINED(3)  -> SYNCED(4)
```

And `wsrep_ready` which goes `OFF` during state transitions.

**Do not route writes to any node that is not `SYNCED(4)` with `wsrep_ready=ON`.**

#### 5.4.3 Quorum Detection

- `wsrep_cluster_status = 'Primary'` -> quorum held, safe
- `wsrep_cluster_status = 'Non-Primary'` -> quorum lost, node isolated
- `wsrep_cluster_status = 'Disconnected'` -> not part of any cluster

If `wsrep_cluster_size < (expected_cluster_size / 2) + 1` on all reachable nodes, emit `ClusterEvent{Type: QuorumLost}` and refuse config writes. This is the daemon's own safety layer on top of Galera's quorum.

#### 5.4.4 Donor Node Avoidance

`wsrep_ready=ON` alone is insufficient — a node in `DONOR/DESYNCED(2)` may still be `wsrep_ready=ON` during IST. Check `wsrep_local_state = 2` directly to exclude donors.

#### 5.4.5 Flow Control

`wsrep_flow_control_paused > 0.1` (>10% of time paused) indicates a struggling node. Use this to influence connection routing weight.

#### 5.4.6 Topology-Aware Connection Pool

```go
type GaleraPool struct {
    nodes     []*GaleraNode
    mu        sync.RWMutex
    healthTick time.Duration
    quorumSize int  // configured expected cluster size
}

type GaleraNode struct {
    DSN    string
    conn   *sql.DB
    state  wsrepState
    mu     sync.RWMutex
    weight float64  // 0.0 = excluded, 1.0 = full weight
}

type wsrepState struct {
    Ready          bool
    LocalState     int
    ClusterStatus  string
    ClusterSize    int
    FlowControlPct float64
    LastCommitted  int64
    CertFailures   int64
}
```

Node selection for writes:
1. Filter: `wsrep_ready=ON AND wsrep_local_state=4 AND wsrep_cluster_status='Primary'`
2. Exclude: `wsrep_local_state=2` (donor)
3. Weight by: inverse of `wsrep_flow_control_paused`
4. Zero eligible nodes -> `ErrNoEligibleNodes`, daemon enters degraded mode

Health poll interval: 2s default, configurable.

#### 5.4.7 MariaDB Schema Detection

MariaDB 10.6+ changed `information_schema.global_status` behavior. Detect once on `Open()`:

```go
func detectSchemaSource(ctx context.Context, db *sql.DB) (bool, error) {
    row := db.QueryRowContext(ctx,
        `SELECT COUNT(*) FROM performance_schema.global_status
         WHERE variable_name = 'wsrep_ready'`)
    var count int
    if err := row.Scan(&count); err != nil || count == 0 {
        return false, nil  // use information_schema
    }
    return true, nil  // use performance_schema
}
```

#### 5.4.8 Go MySQL Driver

Use `go-sql-driver/mysql` directly. No ORM, no sqlx. Rationale: raw SQL per-dialect anyway, ORM buys nothing, `GaleraPool` needs direct `*sql.DB` access per node.

### 5.5 Change Notification Per Backend

| Backend | Mechanism |
|---|---|
| SQLite | In-process channel |
| Postgres | `pg_notify` / `LISTEN` |
| MySQL/MariaDB | Polling on `config_changes` table (500ms default) |

MySQL `config_changes` table (included in migration v1):
```sql
CREATE TABLE config_changes (
    change_id   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    table_name  VARCHAR(64) NOT NULL,
    row_id      VARCHAR(128) NOT NULL,
    operation   ENUM('INSERT','UPDATE','DELETE') NOT NULL,
    changed_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    node_id     VARCHAR(64) NOT NULL
) ENGINE=InnoDB;
```

Each write appends to this table within the same transaction. The `node_id` column lets each sync agent skip changes it originated.

### 5.6 Migration Files

Per-dialect migration directories:
```
internal/store/migrations/
    sqlite/
        000001_initial.up.sql
        000001_initial.down.sql
    postgres/
        000001_initial.up.sql
        000001_initial.down.sql
    mysql/
        000001_initial.up.sql
        000001_initial.down.sql
```

Version numbers are kept in sync across all three dialects — version 7 in SQLite is the same schema version as version 7 in MySQL. Tooling: `golang-migrate/migrate`.

Key DDL differences handled per-dialect:
- Auto-increment: `SERIAL`/`BIGSERIAL` (PG) vs `AUTO_INCREMENT` (MySQL) vs `INTEGER PRIMARY KEY` (SQLite)
- JSON: `JSONB` (PG) vs `JSON` (MySQL 5.7+/MariaDB 10.2+) vs `TEXT` (SQLite)
- Booleans: native `BOOLEAN` (PG) vs `TINYINT(1)` (MySQL/SQLite)
- Timestamps: `TIMESTAMPTZ` (PG) vs `DATETIME(6)` (MySQL) vs ISO8601 `TEXT` (SQLite)
- `pg_notify` triggers: Postgres only — MySQL uses `config_changes` table instead

### 5.7 Store Migration (`rku migrate`)

Supported transitions:

| From | To | Notes |
|---|---|---|
| SQLite | Postgres | Primary upgrade path |
| SQLite | MySQL/MariaDB | Same export-transform-import path |
| Postgres | MySQL/MariaDB | Data type coercion required |
| MySQL/MariaDB | Postgres | Reverse |
| Any | Same (version upgrade) | Schema migration only |
| Postgres/MySQL | SQLite | Supported, warn: losing HA capability |

Migration sequence:
1. Validate target DSN is reachable and schema is clean
2. Stream all rows from source in FK dependency order
3. Apply to target in a single transaction — commit or rollback atomically
4. On success, rewrite `rioku.yaml` to point at new store, signal daemon to reconnect
5. Rename old store file (not delete) — operator deletes after verification

### 5.8 `rioku.yaml` Store Config

```yaml
store:
  driver: mysql  # sqlite | postgres | mysql

  sqlite:
    path: /var/lib/rioku/rioku.db

  postgres:
    dsn: "postgres://rioku:pass@localhost:5432/rioku?sslmode=require"
    max_open_conns: 25
    max_idle_conns: 5
    conn_max_lifetime: 5m

  mysql:
    galera: true
    expected_cluster_size: 3
    nodes:
      - dsn: "rioku:pass@tcp(db1:3306)/rioku?parseTime=true&tls=custom"
      - dsn: "rioku:pass@tcp(db2:3306)/rioku?parseTime=true&tls=custom"
      - dsn: "rioku:pass@tcp(db3:3306)/rioku?parseTime=true&tls=custom"
    health_poll_interval: 2s
    cert_failure_retry_max: 3
    cert_failure_retry_backoff: 100ms
    max_open_conns_per_node: 10
    max_idle_conns_per_node: 2
```

---

## 6. Admin Auth

First-party JWT, no external dependency. Bootstrap flow:

1. `rku init` generates a root credential, writes to a local file
2. Daemon issues short-lived JWT tokens signed with a key it owns
3. RBAC is a first-party module — role definitions and bindings live in the config store
4. SSO/OIDC integration is a plugin, not a core dependency

---

## 7. Certificate Management and Internal PKI

### 7.1 TLS Surface Map

| Surface | Type | Issuer |
|---|---|---|
| Rioku node <-> node gRPC | mTLS | Rioku internal CA |
| Rioku node <-> Caddy admin API | mTLS | Rioku internal CA |
| Rioku <-> Galera nodes | TLS (client cert) | Rioku internal CA |
| Rioku <-> Postgres | TLS (client cert) | Rioku internal CA |
| Admin REST API (external) | TLS (server) | Caddy (ACME) |
| Caddy -> upstream services | TLS (client) | Operator / ACME |

Everything internal to Rioku uses a single internal CA. External-facing TLS is Caddy's domain.

### 7.2 Internal CA

- **Algorithm:** ECDSA P-256 (smaller keys, faster handshakes, full Go/MySQL/Postgres support)
- **CA cert validity:** 10 years, `CA:TRUE, pathlen:0`
- **Node cert validity:** 1 year
- **DB client cert validity:** 1 year
- **Rotation threshold:** 30 days before expiry (configurable)

CA key protection:
- CA private key lives only on the bootstrap node
- Stored encrypted at rest (AES-256-GCM, key from keyring — see Section 8)
- Never distributed to other nodes
- Loss of bootstrap node requires documented CA re-bootstrap procedure

### 7.3 PKI Directory Layout

```
/var/lib/rioku/pki/
    ca/
        ca.crt          # CA certificate (public, safe to distribute)
        ca.key          # CA private key (encrypted, bootstrap node only)
    node/
        node.crt        # This node's certificate
        node.key        # This node's private key (encrypted)
    trust/
        cluster.pem     # Concatenated CA certs (supports CA rotation)
    db/
        galera.crt      # Client cert for Galera connections
        galera.key
        postgres.crt    # Client cert for Postgres connections
        postgres.key
    issued/
        <serial>.crt    # Archive of issued certs (revocation tracking)
```

`db/` certs are separate from `node/` cert — different identity, different CN, appears separately in DB audit logs.

### 7.4 Certificate Manager Interface

```go
type Manager interface {
    // CA operations (bootstrap node only)
    InitCA(ctx context.Context, opts CAOptions) error
    IssueCert(ctx context.Context, req CertRequest) (*IssuedCert, error)
    RevokeCert(ctx context.Context, serial *big.Int) error

    // Node cert operations
    GetNodeCert(ctx context.Context) (*tls.Certificate, error)
    GetDBCert(ctx context.Context, target DBCertTarget) (*tls.Certificate, error)

    // Trust bundle
    GetTrustPool(ctx context.Context) (*x509.CertPool, error)

    // Rotation
    RotateNodeCert(ctx context.Context) error
    RotateDBCerts(ctx context.Context) error

    // Lifecycle
    StartAutoRotation(ctx context.Context) error
    CertExpiry(ctx context.Context, certType CertType) (time.Time, error)
}
```

### 7.5 Auto-Rotation

Rotation loop runs every 6 hours. Rotates any cert expiring within 30 days:

1. Issue new cert (old cert still valid)
2. Write new cert to disk atomically (`write to .tmp -> os.Rename`)
3. Signal consumers to reload via broadcast channel
4. Consumers use `tls.Config.GetCertificate` / `GetConfigForClient` callbacks — called per-handshake, no restart needed
5. DB pool recycles connections naturally on next health poll cycle

### 7.6 Cluster Join — TOFU Flow

New node runs `rku cluster join <bootstrap-node>`:

1. New node generates key pair and CSR
2. Sends CSR to bootstrap node's join endpoint (initial contact skips cert verification — TOFU)
3. Bootstrap node signs CSR with CA key, returns signed cert + CA cert (trust bundle)
4. New node pins CA cert, writes to `pki/`
5. All subsequent communication uses mTLS with verified CA

On `rku cluster join`, the bootstrap node's CA fingerprint is printed and the operator is prompted to confirm it matches `rku ca fingerprint` on the bootstrap node. One manual step, fully automated thereafter. Same UX as SSH host key verification.

### 7.7 MariaDB TLS User Setup

```sql
-- Generated by `rku db setup-tls --target galera`
CREATE USER IF NOT EXISTS 'rioku'@'%'
    REQUIRE SUBJECT '/CN=rioku-galera-client'
    AND ISSUER '/CN=Rioku Internal CA';

GRANT SELECT, INSERT, UPDATE, DELETE
    ON rioku.* TO 'rioku'@'%';
```

`REQUIRE SUBJECT` + `REQUIRE ISSUER` ensures only a cert signed by Rioku's internal CA with the exact CN can connect — valid credentials alone are insufficient.

### 7.8 `rioku.yaml` PKI Config

```yaml
pki:
  dir: /var/lib/rioku/pki
  ca:
    key_algorithm: ecdsa-p256
    validity: 87600h
    key_passphrase_source: auto  # auto | systemd-creds | kernel-keyring | env | encrypted-file
  node:
    validity: 8760h
    rotation_threshold: 720h
    sans:
      dns:
        - node1.rioku.internal
      ip:
        - 10.0.0.1
  db:
    validity: 8760h
    rotation_threshold: 720h
    galera_cn: rioku-galera-client
    postgres_cn: rioku-pg-client
```

---

## 8. Keyring / Secret Store System

### 8.1 Scope

The keyring stores **only the CA private key passphrase**. Node and DB keys have no passphrase — they are protected by filesystem permissions (`0600`, `rioku` service user only) and are short-lived (1 year, auto-rotated).

The daemon needs read-only access to the CA passphrase at runtime (only when issuing or revoking certs). `rku init` and `rku pki rotate-ca` need write access.

### 8.2 Interface

```go
// SecretReader — what the daemon needs at runtime
type SecretReader interface {
    Name() string
    Available(ctx context.Context) bool
    Get(ctx context.Context, key string) ([]byte, error)
    Durability() Durability
}

// SecretStore — extends SecretReader with write (used by rku init only)
type SecretStore interface {
    SecretReader
    Set(ctx context.Context, key string, value []byte) error
    Delete(ctx context.Context, key string) error
}

type Durability int
const (
    DurabilitySession    Durability = iota // lost on reboot
    DurabilityBoot                         // survives process restart, not reboot
    DurabilityPersistent                   // survives reboot
)
```

### 8.3 Backend Priority Chain

Selection is explicit-first, then auto-detected. Never silently picks a backend the operator didn't intend.

```
auto detection order:
  1. systemd-creds    (CREDENTIALS_DIRECTORY is set)
  2. kernel-keyring   (Linux, keyctl available)
  3. env              (RIOKU_SECRET_* vars present)
  4. encrypted-file   (always available, prompts interactively)
```

Per-environment defaults:

| Environment | Primary | Fallback chain |
|---|---|---|
| Production Linux (systemd 250+) | systemd-creds | kernel-keyring -> env |
| Production Linux (older systemd) | kernel-keyring | env |
| Container / CI | env | -- |
| Dev Linux | kernel-keyring | env -> encrypted-file |
| Dev macOS | keychain | env -> encrypted-file |
| Dev Windows | wincred | env -> encrypted-file |

### 8.4 Backends

#### systemd-creds (Primary Production)

Reads from `$CREDENTIALS_DIRECTORY/rioku.<key>`. Read-only — credentials are provisioned at deploy time.

Operator provisioning flow (documented as the production standard):
```bash
# Generate passphrase and encrypt it as a systemd credential
rku pki gen-passphrase | systemd-creds encrypt \
    --name=rioku.ca-key-passphrase \
    --pretty \
    - /etc/credstore.encrypted/rioku.ca-key-passphrase

# Reference in service unit:
# LoadCredentialEncrypted=rioku.ca-key-passphrase:/etc/credstore.encrypted/rioku.ca-key-passphrase
```

`rku pki gen-passphrase` generates 32 bytes of CSPRNG output, base64url encoded, written to stdout. Plaintext passphrase never touches disk.

#### kernel-keyring (Secondary Production)

Uses `golang.org/x/sys/unix` keyctl syscalls directly. Pure Go, no CGo.

- Attempts persistent keyring first (survives reboot, requires `keyctl persistent` setup)
- Falls back to session keyring (survives daemon restarts within same systemd service session)

Service unit must include `KeyringMode=private` to isolate the keyring from other processes.

#### env (CI/Container/Dev)

Key `ca-key-passphrase` -> `RIOKU_SECRET_CA_KEY_PASSPHRASE`. Uppercase, hyphens to underscores, `RIOKU_SECRET_` prefix.

`Set` is not supported — env backend is read-only at runtime.

#### encrypted-file (Dev Fallback)

AES-256-GCM. Key derived via scrypt (`N=32768, r=8, p=1`) from an interactively prompted passphrase. Passphrase prompted once on first access, held in memory for process lifetime, zeroed on exit.

Used when no other backend is detected. Displays a warning recommending production backends.

#### macOS Keychain / Windows Credential Manager

Thin shims implementing `SecretStore`. Sufficient for dev. Not tested or documented for production. macOS uses `github.com/keybase/go-keychain` (CGo on darwin — unavoidable). Windows uses `github.com/danieljoos/wincred` (pure Go via syscall).

### 8.5 Memory Safety

All secrets returned from `Get()` are wrapped in a `Secret` type that zeroes the byte slice on `Release()`:

```go
type Secret struct {
    data    []byte
    zeroed  bool
    // stack trace captured in test mode for leak detection
}

func (s *Secret) Bytes() []byte { return s.data }
func (s *Secret) Release()      { /* zero s.data, set s.zeroed */ }
```

In test mode, a `runtime.SetFinalizer` panics if `Release()` was never called. Zero production overhead.

---

## 9. Plugin Architecture

### 9.1 Plugin Type Taxonomy

| Type | Extension Mechanism | Rebuild Required? |
|---|---|---|
| Traffic Plugin | Caddy module (Go) | Yes -- compiled into Caddy binary |
| Middleware Plugin | Go interface, registered via `init()` | No (daemon rebuild required for third-party) |
| CLI Plugin | Go interface, registered via `init()` | No (daemon rebuild required for third-party) |
| Web Plugin | ES module loaded dynamically by SPA | No |
| Agentic Plugin | Middleware or Traffic depending on scope | Varies |

### 9.2 Go Plugin Loading Strategy

**Do not use Go's `plugin` package** — no unloading, same Go version required, OS restrictions.

- First-party middleware and CLI plugins: compiled into daemon via `init()` registration
- Third-party middleware/CLI plugins: operator rebuilds daemon binary (same xcaddy pattern, different binary)
- Traffic plugins: compiled into Caddy binary via xcaddy
- Web plugins: ES modules, loaded at runtime by SPA

Two build pipelines exist: one for Caddy (traffic plugins), one for the daemon (middleware/CLI plugins). Both use the same `BuildService` abstraction.

### 9.3 Build Pipeline States

```
IDLE -> TRIGGERED -> FETCHING_DEPS -> BUILDING -> TESTING ->
SWAPPING -> COMPLETE
                ↓
              FAILED (reason + logs)
```

Zero-downtime Caddy swap: drain via admin API -> start new process -> verify it accepts config -> kill old process. Timeout -> revert to old binary.

### 9.4 Plugin Manifest

```go
type PluginManifest struct {
    ID          string
    Name        string
    Version     string
    Type        PluginType
    CaddyDeps   []string         // Caddy module IDs (triggers Caddy rebuild)
    ConfigSchema json.RawMessage // JSON Schema for plugin config
}
```

### 9.5 Hosted Build Service

A separate, self-hostable Go binary. Receives a build manifest, runs xcaddy in an isolated environment, returns a binary artifact. Operator points their daemon at either the official Rioku build service or their own instance. Protocol: REST (not gRPC — it's an external service).

Plugin distribution: local xcaddy build first, hosted build service as fallback. Both produce identical artifacts.

---

## 10. Cluster Sync Architecture

### 10.1 Sync Agent

Each node runs a sync agent:

```
┌──────────────┐     Watch      ┌──────────────┐
│ Config Store │ ──────────────>│ Sync Agent   │
│ (local)      │  ChangeEvent   │              │
└──────────────┘                │  - Debounce  │
                                │  - Serialize │
        ┌───────────────────────│  - Broadcast │
        │    gRPC SyncState     └──────────────┘
        v
┌──────────────┐
│ Other Nodes  │
│ (via gRPC)   │
└──────────────┘
```
