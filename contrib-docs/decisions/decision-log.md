# Rioku — Decision Log

Architectural and project decisions made during the design phase.

---

| Date | Decision | Rationale |
|---|---|---|
| 2026-04-02 | Use Caddy as traffic engine | Native live config API, automatic HTTPS, Go ecosystem, better architecture than Nginx for this use case |
| 2026-04-02 | All features ship as modules, including first-party | Enables lean deployments; required for honest open-core commercial model |
| 2026-04-02 | Go for entire stack | Matches Caddy, single binary distribution, strong fit for proxy/gateway workloads |
| 2026-04-02 | CLI-first, web panel as parallel interface | Operational simplicity first; scriptable and automatable before GUI |
| 2026-04-02 | Never paywall features; sell services and support | Philosophical commitment; differentiates from Kong's model |
| 2026-04-02 | Config store owns source of truth; Caddy admin API is a sync target | Caddy's admin API is node-local; multi-node requires an owned sync layer |
| 2026-04-02 | Project name: Rioku | Clean proper noun identity, no trademark conflicts in API gateway / infrastructure space |
| 2026-04-02 | CLI alias: `rku` | Short, clean namespace (`rev` conflicts with Linux util-linux, `rvn` conflicts with RavenDB) |
| 2026-04-02 | gRPC internally, REST externally via grpc-gateway | Single proto definition, no duplication, SSE for live events |
| 2026-04-02 | SQLite default, Postgres for HA, MariaDB/Galera for multi-master | Match deployment complexity to use case |
| 2026-04-02 | Caddy as managed child process, not forked | Required for zero-downtime binary replacement, lifecycle control |
| 2026-04-02 | Valkey (not Redis) for shared state | Linux Foundation fork, SSPL-free, drop-in compatible |
| 2026-04-02 | First-party JWT for admin auth, no external dependency | Bootstrap simplicity; SSO/OIDC as optional plugin |
| 2026-04-02 | ECDSA P-256 for internal CA | Smaller keys, faster handshakes, full Go/MySQL/Postgres support |
| 2026-04-02 | Do not use Go's `plugin` package | No unloading, same Go version required, OS restrictions |
| 2026-04-02 | No ORM, raw SQL per-dialect | `GaleraPool` needs direct `*sql.DB` access per node; ORM buys nothing |
| 2026-04-02 | TraceStore separate from config store | Different access patterns (high-write, append-only, time-range queries) |
| 2026-04-02 | DuckDB for production trace store (Phase 2+) | Columnar, excellent analytics, embeds as library; CGo is the only cost |
| 2026-04-02 | MCP server wraps existing gRPC services | No separate logic; tool schemas generated from proto definitions |
| 2026-04-02 | Message content NOT stored in traces by default | Privacy and storage cost; opt-in, controlled by config, redactable by policy |
