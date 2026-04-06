# Rioku — Open Questions

Technical questions requiring deeper investigation before implementation.

---

1. **Embedded distributed config store** — Evaluate bbolt + hashicorp/raft as an embedded config store backend for small-to-medium clusters (3-7 nodes) that ships in the single binary with zero external dependencies. This would sit alongside SQLite (single-node dev) and Postgres/MariaDB (enterprise). Key areas to investigate: raft-boltdb for log/stable storage, FSM design for config state machine, snapshot/restore, memberlist for cluster discovery and health (replaces manual node management), Olric for embedded shared state (rate limit counters, sessions — replaces Redis/Valkey). The store.Driver interface already abstracts this — the question is whether the embedded approach is viable and worth the implementation cost vs just requiring Postgres for multi-node.

2. **WASM plugin runtime** — Evaluate wazero (pure Go, no CGo) as a second plugin execution path alongside compiled Go plugins. WASM would allow third-party plugins to be hot-loaded at runtime without rebuilding Caddy or the daemon, in any language that compiles to WASM (Rust, Go, C, AssemblyScript). Sandboxed by design — aligns with the "untrusted plugins default to no trust" decision. Key areas to investigate: host function API design (what capabilities do plugins get?), performance overhead vs compiled Go for traffic-path plugins, memory limits, how Envoy/Traefik/Kong implement their WASM plugin models, whether wazero is mature enough for production traffic-path use. First-party plugins would stay compiled Go for performance; WASM would be the third-party path.
