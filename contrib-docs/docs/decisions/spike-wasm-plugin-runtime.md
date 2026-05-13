# Spike: WASM Plugin Runtime

**Date:** 2026-04-06
**Status:** Complete
**Verdict:** GO

---

## Summary

Evaluated wazero as a WASM plugin runtime for third-party plugin hot-loading. The host ABI works, hot-swap works, performance is acceptable, and the architecture is sound. WASM plugins are positioned as the third-party/sandboxed tier alongside compiled Go plugins for first-party performance-critical code.

## Benchmark Results (AMD Threadripper 1950X)

| Metric | WASM | Native Go | Ratio | Target |
|---|---|---|---|---|
| Per-request latency | **13us** | 781ns | 16.7x | <100us |
| Parallel latency (32 cores) | **7.8us** | — | — | — |
| Allocs/op | 20 | 6 | 3.3x | — |
| Bytes/op | 24KB | 624B | 39x | — |

### Context

The 13us overhead is per-invocation of a simple plugin (read path, set header, log). In a real API gateway request that spends 1-50ms on network I/O, 13us is <1.3% overhead. Under parallel load, pool reuse reduces this to 7.8us.

The overhead ratio (16.7x) is higher than the research-predicted 1.5x because our test measures the full cycle including instance acquire/release and context setup. The raw WASM execution is much cheaper — the overhead is dominated by the Go<->WASM bridge (memory allocation, function call trampolines).

## Features Validated

| Feature | Status | Notes |
|---|---|---|
| Host function ABI (9 functions) | Works | get/set headers, path, method, status, body, log, config |
| Plugin loading + compilation | Works | 440-byte WASM binary, instant compilation |
| Instance pool | Works | Pre-warm + on-demand creation, proper drain |
| Hot-swap (v1 -> v2) | Works | Zero downtime, in-flight requests complete on old version |
| Concurrent requests (100 goroutines) | Works | Race-free under `-race` |
| Pool drain (graceful shutdown) | Works | Waits for in-flight, then closes |
| Unload plugin | Works | Clean removal from host |

## Architecture

Two-tier plugin system:

| Tier | Mechanism | Use Case |
|---|---|---|
| Compiled Go | `init()` registration | First-party, trusted, performance-critical |
| WASM (this spike) | wazero hot-load | Third-party, sandboxed, any language |

### ABI Design

Rioku-native ABI, inspired by http-wasm (Traefik v3). NOT proxy-wasm.

**Host exports (rioku module):**

- `get_request_header`, `set_request_header`
- `get_request_path`, `get_request_method`
- `set_response_status`, `set_response_header`, `set_response_body`
- `log_info`
- `get_plugin_config`

**Guest exports:**

- `malloc(size) -> ptr` — bump allocator for host-to-guest data
- `handle_request() -> action` — 0=continue, 1=short-circuit

## Dependencies

| Dependency | License | CGo |
|---|---|---|
| tetratelabs/wazero v1.11.0 | Apache-2.0 | No |

Binary impact: ~5MB.

## Key Findings

1. **wazero is production-quality** — 6K+ stars, used by Dapr, Trivy, Traefik v3. Pure Go, no CGo.
2. **Instance pooling is essential** — module instances are NOT thread-safe. Pool pre-warms instances and hands them to request goroutines.
3. **Hot-swap works cleanly** — compile new module, swap pool, drain old pool. Zero downtime.
4. **Memory model requires discipline** — all data exchange through linear memory via malloc + ptr/len pairs. Guest SDKs will abstract this.
5. **WAT is viable for testing** — 440-byte .wasm files compiled from WAT exercise the full ABI without needing TinyGo.

## Recommendation

**Proceed to implementation** as a Phase 6 deliverable (Plugin registry + build service phase). Before that:

### Remaining Work for Production

- **Guest SDKs** — TinyGo SDK and Rust SDK that abstract the raw ABI (malloc, ptr/len pairs)
- **Memory limit enforcement** — wire `WithMemoryLimitPages` from config, test OOM behavior
- **Additional ABI functions** — `get_request_body`, `http_call` (outbound), `kv_get`/`kv_set`
- **ABI versioning** — version the host module so plugins can declare compatibility
- **Plugin manifest** — metadata (name, version, ABI version, capabilities required)
- **Security audit** — review host function implementations for capability escalation
- **proxy-wasm compatibility layer** — optional, via `mosn/proxy-wasm-go-host` if demand exists
