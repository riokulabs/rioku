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
| 2026-04-04 | Plugin registry: three tiers — hosted central, self-hosted, and local | Central registry hosted by RiokuLabs is the default; operators can self-host the same registry for air-gapped or private environments; local plugins (no registry interaction) supported for private/internal plugin development |
| 2026-04-04 | SQLite only for simple self-hosting and local dev; strongly recommend Postgres/MariaDB for all other use cases | SQLite is a convenience default, not a production recommendation; docs and CLI should steer users toward a proper SQL database for anything beyond single-node dev/homelab |
| 2026-04-04 | Web plugins default to untrusted; security must not be a chore | All web plugins sandboxed by default (no trust). Security model should be strict but operationally simple — operators shouldn't have to manually configure isolation for every plugin |
| 2026-04-04 | React + TanStack for admin panel and marketing site; no Vercel-owned tech | Replace SvelteKit with React + TanStack (Router, Query). Larger ecosystem, better AI-assisted dev, more hire-able. Strictly avoid Vercel-owned frameworks (Next.js, etc.). Vite as build tool |
| 2026-04-04 | Caddy version coupling: sliding window, version-aware adapter, never block | Support current + previous Caddy minor version; version-aware Admin API adapter (thin shim per version range) absorbs API breaks; traffic plugins pin Caddy version at build time via build service; daemon detects Caddy version on startup — warns on untested, never refuses to start; hot-swap by replacing Caddy child process binary |
| 2026-04-04 | Bootstrap token: stdout-only, no OS keyring, operator-managed storage | Matches industry standard (Kong, HashiCorp Vault, Kubernetes, Consul). `rku init` prints token to stdout once; operator is responsible for secure storage. No keyring integration — these run on servers, not desktops. Bootstrap token should be revocable/replaceable |
| 2026-04-04 | Apache 2.0 for core; modules can be licensed independently | Apache 2.0 chosen over MIT for explicit patent grant. Matches Kong, APISIX, Caddy. Core is a one-way door (can't relicense stricter later), but separate modules/plugins under their own go.mod can use any license (FSL, BSL, proprietary). Aligns with "never paywall core features" philosophy |
| 2026-04-04 | CLI alias `rku` confirmed — no conflicts | Verified clean across Ubuntu/Debian, Fedora/RHEL, Arch, macOS Homebrew, and GitHub. No existing binary, package, or established computing meaning |
| 2026-04-04 | Primary domain: `rioku.dev`; also own `rioku.io` and `rioku.ai` | `.dev` is the primary — signals developer tooling, HTTPS-enforced by default. `.io` as secondary/redirect. `.ai` reserved for potential future use. `.com` unavailable (domain squatter), not needed |
| 2026-04-04 | CLI token storage: external credential helpers (git-style), not built-in keyring | Credential helper protocol (stdin/stdout contract) lets users bring their own backend (macOS Keychain, libsecret, wincred, 1Password, Vault, pass). No CGo, no OS detection, no cross-platform keyring code in the main binary. Plaintext `token` in config file still works for servers/simple setups. Precedence: flag > env > credential_helper > config file token |
| 2026-04-04 | `--non-interactive` exits code `2` on missing required flags | Standard POSIX usage error convention. Matches kubectl, aws CLI behavior. No prompts, no ambiguity — scripts branch on exit code |
| 2026-04-04 | Git practices: Conventional Commits, squash merge, signed commits, no AI references in messages | Feature branches + PRs (main commits OK during early solo dev). Squash merge always. Commit signing required. No AI tool names in commit messages. All planning in GitHub Projects/Issues |
| 2026-04-06 | GO: Embedded raft config store for zero-dependency clustering | hashicorp/raft + bbolt + memberlist. Spike validated: write 212us, read 9.6us, leader failover <3s, all `-race` clean. Additive tier alongside Postgres — for edge/small clusters (3-7 nodes) where external databases are impractical. See `spike-embedded-raft-store.md` |
| 2026-04-06 | GO: Gossip CRDT counters for embedded rate limiting | PN-Counter CRDTs over memberlist gossip. Spike validated: 10M increments/sec, zero allocs on hot path, 3-node convergence works. Approximate by design — Valkey/Redis/KeyDB remains the path for exact counts at high load |
| 2026-04-06 | GO: groupcache + otter for embedded distributed cache | groupcache for peer-to-peer consistent-hash cache with single-flight dedup, otter as L1 W-TinyLFU hot cache. Spike validated: L1 hit 139ns, peer fetch 931ns, single-flight works (50 reqs -> 1 getter call) |
| 2026-04-06 | DROP: Olric for embedded shared state | Last release Jan 2023, essentially unmaintained single-person project. Too risky for a core infrastructure component. Valkey stays as the production shared-state path |
| 2026-04-06 | GO: WASM plugin runtime via wazero | wazero v1.11.0, pure Go, no CGo. Spike validated: 13us/request overhead (target <100us), hot-swap works, 100 concurrent goroutines race-free. Rioku-native ABI, not proxy-wasm. WASM for third-party/sandboxed plugins, compiled Go for first-party. See `spike-wasm-plugin-runtime.md` |
| 2026-04-06 | Sessions stored in config store DB, not separate shared state | Sessions are low-frequency CRUD — just another table replicated via raft/Postgres/Galera. No new infrastructure needed |
