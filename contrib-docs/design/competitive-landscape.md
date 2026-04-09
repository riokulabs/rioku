# Rioku — Competitive Landscape & Positioning Reference
**Version:** 1.0  
**Date:** 2026-04-03  
**Purpose:** Working reference document for competitive analysis and product positioning. Use this as context when continuing Rioku product work with Claude.

---

## 1. What Rioku Is

Rioku is a **fully open-source API + AI gateway platform** built on Caddy as its traffic engine. It is not affiliated with HyperSystems — it is a separate project by Derrick, starting as personal/open-source with a path toward open-core commercial.

### Core Identity
- Gateway-first, agentic-native by design — not retrofitted
- Caddy backbone (Go, live config API, automatic HTTPS, single binary)
- Plugin-extensible at every layer: traffic pipeline, CLI, admin panel, middleware
- Zero enterprise paywalls — all functional features are open source
- Commercial model: services, support, certified module bundles — not feature gating

### Name & Branding
- **Product name:** Rioku (previously explored as Revyn during research)
- **CLI binary:** `rioku`
- **Short alias:** `rku`
- **Tagline direction:** "The open, secure [API/AI] infrastructure" — declarative "The X" format, combining open source + security messaging

### Prior Architecture Work (from design doc v0.2)
```
┌──────────────────────────────────────────┐
│             Admin Panel (SPA)            │  ← web UI, plugin-extended
└────────────────┬─────────────────────────┘
                 │ REST / WebSocket
┌────────────────▼─────────────────────────┐
│          CLI / Core Daemon (Go)          │  ← plugin host
│                                          │
│  ┌───────────────────────────────────┐   │
│  │   Config Store (SQLite / PG)     │   │  ← source of truth
│  └──────────────┬────────────────────┘   │
│                 │ sync                   │
│  ┌──────────────▼────────────────────┐   │
│  │    Caddy Admin API Client        │   │  ← pushes live config
│  └──────────────┬────────────────────┘   │
│  ┌──────────────▼────────────────────┐   │
│  │    xcaddy Build Manager          │   │  ← rebuilds when traffic
│  └──────────────┬────────────────────┘   │     plugins are added
└─────────────────┼────────────────────────┘
                  │
┌─────────────────▼────────────────────────┐
│    Caddy (compiled w/ active modules)    │  ← traffic plane
└──────────────────────────────────────────┘
                  │
         ┌────────▼────────┐
         │  Redis (opt.)   │  ← shared state (rate limits, sessions, cache)
         └─────────────────┘
```

**Key architectural decisions already made:**
- Traffic engine: Caddy (live config API vs. Nginx reload model)
- Language: Go throughout
- Config source of truth: Rioku-owned store (not Caddy state)
- Sync: opportunistic push to Caddy Admin API per node
- Shared state: Redis as optional module (not required for single-node)
- Admin: CLI-first, SPA as parallel interface
- Single binary distribution goal

---

## 2. The Competitive Landscape

### 2.1 Market Segments

The space has three overlapping segments Rioku touches:

1. **Traditional API Gateways** — routing, auth, rate limiting, plugin ecosystem (Kong, APISIX, Tyk)
2. **AI/LLM Gateways** — LLM proxy, token management, semantic routing, PII, RAG (Kong AI, Tyk AI Studio, LiteLLM, Portkey)
3. **Reverse/Forward Proxies** — raw traffic handling, ingress, service mesh (Traefik, Envoy, NGINX, HAProxy)

Rioku competes primarily in segments 1 and 2, with segment 3 handled by Caddy underneath.

---

### 2.2 Player-by-Player Breakdown

#### Kong Gateway + Kong AI Gateway
**The closest direct competitor for the full platform vision.**

- **Engine:** NGINX + LuaJIT (C-based, high performance)
- **Performance:** Benchmarked 228% faster throughput vs. Portkey, 859% vs. LiteLLM at scale (Kong-published, take with a grain of salt)
- **Deployment:** Self-hosted OSS, Konnect SaaS control plane, Kubernetes
- **License:** Apache 2.0 core; enterprise features require Konnect subscription

**Core API Gateway Features:**
- Declarative + DB-less config, REST Admin API, K8s Ingress Controller
- 60+ plugins: rate limiting, JWT/OAuth/ACL auth, circuit breaking, caching, request/response transformation, canary/blue-green, mTLS
- Plugin hub (community + commercial)
- Control plane / data plane split (Konnect)

**AI Gateway Features (v3.10/3.11 — April 2025):**
- Universal LLM API: OpenAI, Anthropic, Azure AI, AWS Bedrock, GCP Vertex, Mistral, HuggingFace, Databricks
- **Semantic routing** — routes to best model based on prompt content/intent (unique capability)
- **Semantic caching** — caches responses to semantically equivalent prompts (not just exact matches)
- **Auto-RAG** — automated RAG pipeline at gateway layer; generates embeddings, fetches from vector DB, appends to prompt automatically; no developer code required
- **PII sanitization** — 20+ PII categories, 12 languages
- **Token-based rate limiting** — limit by prompt tokens, response tokens, total tokens, per user/app/time period
- **Multi-LLM load balancing** — AI Proxy Advanced plugin; weighted, cost-based, latency-based
- MCP server governance, authentication, observability, auto-generation from REST APIs
- A2A (Agent2Agent) protocol support
- Azure OpenAI Assistants support (stateful agents with memory)
- Batch LLM execution
- AWS Bedrock Guardrails integration
- AI observability: pre-built dashboards, token-level analytics, TTFT tracking
- Prompt injection protection, content filtering

**Kong's Key Gaps / Weaknesses (Rioku opportunities):**
- Core enterprise features (RBAC, OAuth2, advanced rate limiting) paywalled behind Konnect
- NGINX foundation requires workarounds for live config mutation (Kong manages this, but the constraint exists)
- Large operational footprint; not a single binary
- Complex dependency graph for self-hosted HA setups
- No auto-HTTPS out of the box

---

#### Tyk + Tyk AI Studio
**Strong in governance/enterprise; AI Studio is new and rapidly evolving.**

- **Engine:** Go
- **Deployment:** Self-hosted (Community OSS), Enterprise, Kubernetes, SaaS control plane
- **License:** MPL 2.0 core; Enterprise edition commercial
- **Certifications:** ISO 27001, SOC2

**Core API Gateway Features:**
- REST, GraphQL, gRPC, SOAP, Kafka/async, event-driven
- Auth, rate limiting, quotas, caching, protocol mediation/transformation
- Native OpenTelemetry, Tyk Dashboard, Tyk Pump (export to BI tools)
- Open Policy Agent (OPA) integration
- Hybrid deployment (cloud control plane + on-prem data plane)
- Declarative config, CI/CD integration

**Tyk AI Studio Features:**
- Single control plane for LLMs, agents, MCP tool chains, RAG workloads
- Full lifecycle audit: prompts, responses, tool calls
- PII redaction and content filtering at gateway
- Multi-vendor LLM routing with automatic failover: OpenAI, Anthropic, Mistral, Vertex, Gemini, Ollama, private models
- Policy-based model selection by use case, budget, latency, risk tier
- Enterprise SSO + RBAC for scoped tool access
- MCP: remote catalogues, secure local deployment, API-to-MCP conversion
- Unified Plugin SDK — isolated gRPC plugin processes for security and fault tolerance
- GitHub-to-RAG pipelines (via plugin extensions)
- Token metering, hard spend caps, cost attribution by team/project/application
- Developer self-service portal with admin approval + budget workflows
- OpenAPI spec → tool conversion in ~10 minutes; combine multiple tools in same chat

**Tyk's Key Gaps / Weaknesses:**
- AI Studio is relatively new; feature depth less proven than Kong AI at scale
- No semantic routing or semantic caching
- Plugin extensibility is less mature than Kong's ecosystem
- Weaker community adoption in Western developer market vs. Kong

---

#### Apache APISIX
**Highest raw performance of the OSS options; fully open source including all AI plugins.**

- **Engine:** NGINX + LuaJIT (same base as Kong); etcd for config
- **Performance:** 140,000 QPS, 0.2ms latency (AWS 8-core benchmark)
- **Deployment:** Kubernetes (native), bare metal, Docker; no managed cloud offering
- **License:** Apache 2.0 — fully OSS, no enterprise paywall on any feature

**Core API Gateway Features:**
- Dynamic routing, upstream, certificates with hot reload (no restart)
- TCP/UDP proxy, Dubbo proxy, MQTT proxy (load balance by client_id, MQTT 3.1 + 5.0)
- gRPC transcoding (HTTP/JSON → gRPC)
- 100+ plugins, multi-language plugin support: Java, Go, Python, Node.js, WebAssembly
- Canary, blue-green, A/B testing, circuit breaking
- Works as K8s Ingress Controller and east-west (service-to-service) proxy
- Prometheus + Grafana built-in integrations

**AI Gateway Features (v3.12+, fully OSS):**
- Multi-LLM proxy: OpenAI, DeepSeek, Claude, Mistral, Gemini and more (no vendor lock-in)
- ai-proxy-multi: load balancing, retries, fallbacks, health checks across LLMs
- Token rate limiting: by Route, Service, Consumer, Consumer Group, or custom params; single-node and cluster-level
- RAG support (Azure OpenAI + Azure AI Search integration)
- Prompt Guard (intercepts sensitive/illegal prompts)
- Prompt Decorator and Prompt Template
- Response filtering and content moderation
- MCP bridge plugin: converts stdio-based MCP servers to HTTP SSE
- AI observability metrics: TTFT, LLM model name, prompt tokens, completion tokens — usable in access logs or as Prometheus metrics
- 300+ model access via AI/ML API provider integration (single YAML)

**APISIX's Key Gaps / Weaknesses:**
- No semantic routing or semantic caching
- No PII sanitization plugin
- No auto-RAG (requires explicit configuration)
- etcd dependency adds operational complexity
- Admin UI exists but is less polished
- Weaker Western market mindshare vs. Kong
- No managed cloud offering (operational burden fully on user)

---

#### Traefik (+ Traefik Hub + Traefik AI Gateway)
**Best developer UX for K8s ingress; AI capabilities are newer and thinner.**

- **Engine:** Go, single binary, auto-discovers from Docker/K8s/Nomad/Consul
- **Deployment:** Any environment; single stateless binary
- **License:** MIT (OSS proxy); Hub is commercial

**Core Traefik Proxy (OSS):**
- Zero-config service discovery (labels/annotations drive routing)
- Auto Let's Encrypt TLS
- HTTP/1, HTTP/2, HTTP/3, TCP, UDP, gRPC, WebSocket
- Middleware: rate limiting, retries, circuit breaking, headers manipulation
- Built-in dashboard

**Traefik Hub (Enterprise):**
- JWT, OIDC, LDAP authentication
- WAF (Web Application Firewall)
- Runtime API governance
- API lifecycle management, developer portal

**Traefik AI Gateway:**
- Unified LLM access: OpenAI, Anthropic, Azure OpenAI, AWS Bedrock, Ollama, Mistral
- Centralized observability for LLM traffic
- MCP Gateway: governs AI agent interactions with MCP servers; task-aware policies, session-smart routing

**Traefik's Key Gaps / Weaknesses:**
- Benchmarked unsafe for multi-Gateway scenarios (Gateways in different K8s namespaces can collide)
- Does not support dynamic ports
- Route propagation can take seconds (vs. milliseconds for Kong/Istio)
- Memory consumption issues reported in v3.x under load/DoS
- AI capabilities are thin compared to Kong, Tyk AI Studio
- Extensibility is limited relative to APISIX and Kong

---

#### Envoy / Envoy Gateway
**The service mesh backbone; not a product people deploy directly as an API gateway.**

- **Engine:** C++, extremely high performance
- **Role:** Data plane for Istio, Consul Connect, AWS App Mesh; foundation for kgateway, Gloo
- **Protocol support:** HTTP/1, HTTP/2, HTTP/3, gRPC, WebSocket — comprehensive
- **Extensibility:** WASM plugin support
- **xDS APIs:** Real-time dynamic config without restarts
- **AI:** Token-level flow control, unified LLM provider access, upstream auth for LLM traffic
- **Known issue:** Memory leak confirmed in benchmark testing — grew to 45GB in 15 minutes under route-churn load; not suitable for high-churn environments without mitigation
- **Complexity:** Requires a control plane (Istio, kgateway, etc.); not operator-friendly standalone

**Relevance to Rioku:** Low direct competition. Envoy is infrastructure Rioku users may have underneath their K8s clusters, not a product they choose instead of Rioku.

---

#### LiteLLM
**Most widely adopted OSS LLM proxy. Developer-first, Python-based.**

- **Engine:** Python
- **Performance:** 8ms P95 latency at 1k RPS; ~859% slower throughput than Kong at scale (per Kong benchmark)
- **Deployment:** Self-hosted; Docker; admin UI included
- **License:** MIT

**Features:**
- 100+ LLM providers in OpenAI-compatible format
- Virtual keys, cost tracking, team/user budget enforcement
- Router with retry/fallback logic
- MCP gateway with per-key access control
- A2A (Agent2Agent) support
- Content filtering, PII masking, safety checks (basic)
- Langfuse, MLflow, Helicone integrations
- SSO/SAML, audit logs (enterprise tier)

**LiteLLM's Key Gaps:**
- No enterprise RBAC, workspaces, audit logs in OSS version
- No prompt versioning or approval workflows
- No semantic routing, semantic caching, Auto-RAG
- High operational overhead for production deployments
- Not an API gateway — LLM-only; cannot replace general traffic management

---

#### Portkey
**Observability-first AI gateway, strong enterprise UX, SaaS + partial OSS.**

- **Engine:** TypeScript
- **Providers:** 1,600+ models across 45+ providers
- **Deployment:** SaaS primary; partial OSS
- **Pricing:** Starts at $49/month

**Features:**
- Advanced guardrails (content policies, output controls)
- Virtual key management for teams
- Configurable routing: automatic retries, fallbacks, exponential backoff
- Prompt versioning, testing, environment promotion, approval workflows
- Prompt engineering studio
- Enterprise: SSO, audit trails, compliance controls
- Detailed analytics, custom metadata, alerting
- Observability focus — strongest in class for LLM tracing

**Portkey's Key Gaps:**
- Not a full API gateway
- No self-hosted option for most features
- Not open source

---

#### Cloudflare AI Gateway
**Edge-native, zero-config for Cloudflare users. Convenience product, not infrastructure.**

- **Network:** Cloudflare global edge
- **Models:** 350+ across providers
- **Setup:** One URL change; works with existing Cloudflare deployments

**Features:**
- Response caching (reduce redundant LLM calls)
- Rate limiting and controls
- Request retries and model fallback
- Real-time analytics (requests, tokens, costs)
- Logging: up to 100M total logs (10M per gateway, logs within 15s)

**Cloudflare's Key Gaps:**
- No self-hosting; fully locked to Cloudflare
- No guardrails, no PII redaction, no governance
- No semantic routing or caching
- No developer portal or enterprise access controls
- Convenience-first; not infrastructure-grade

---

#### NGINX / F5 NGINX AI Gateway
**Battle-tested infrastructure; AI capabilities are an enterprise add-on.**

- Powers 50%+ of web traffic worldwide
- Kong and APISIX are built on top of it
- F5 NGINX AI Gateway module adds:
  - Bidirectional LLM request/response inspection
  - PII cleanup processors
  - Content compliance processors (hooks to external content security services)
  - Custom Python script attachment for domain-specific review
- Primary differentiator: existing enterprise deployments can add AI inspection without rearchitecting
- Not competitive for net-new deployments in the developer market

---

#### HAProxy
**Maximum L4/L7 throughput; minimal AI story.**

- C-based; ~42,000 RPS in K8s ingress benchmarks; lowest resource consumption
- 2025 LTS release focused on performance and enterprise security
- Gateway API support via HAProxy K8s Ingress Controller 3.1
- No meaningful AI/LLM capabilities
- Relevant to Rioku only as the alternative people choose when they need pure throughput with no management layer

---

### 2.3 AI-Native Pure-Plays (Smaller Players)

| Product | Angle | Key Strength | Gap vs. Rioku |
|---|---|---|---|
| **Helicone** | Rust-based OSS LLM proxy | Latency load-balancing, native observability, ~50ms add | LLM-only, not an API gateway |
| **OpenRouter** | 500+ model marketplace, pay-per-use | No infra to run, 5% markup model | No self-host, no governance |
| **Bifrost (Maxim AI)** | Go-based, <11µs overhead, 50x faster than LiteLLM | Raw throughput for LLM proxy | Newer, unproven ecosystem, LLM-only |
| **Vercel AI Gateway** | Edge-native, zero-config for Vercel users | Next.js integration, streaming UX | Locked to Vercel, no governance |
| **Cequence** | API security + AI threat detection | Bot mitigation, API protection for AI endpoints | Security-only, not a gateway |

---

## 3. Feature Map Across the Space

The following are all capabilities that exist somewhere in this competitive space. This serves as a comprehensive list for product planning.

### 3.1 Core API Gateway

| Capability | Notes |
|---|---|
| Dynamic routing (path, header, host, method) | Table stakes |
| Load balancing (round-robin, least-conn, weighted, consistent hash) | Table stakes |
| Health checking (active, passive) | Table stakes |
| Rate limiting (request-based) | Table stakes |
| Authentication: JWT, API Key, Basic Auth, OAuth 2.0, mTLS | Table stakes |
| Authorization: RBAC, ACL, OPA integration | Kong, APISIX, Tyk |
| Request/response transformation | Table stakes |
| Circuit breaking | Table stakes |
| Retries and timeout management | Table stakes |
| Caching (response cache) | Most |
| TLS termination + auto-HTTPS | Caddy/Traefik lead; APISIX/Kong manual |
| HTTP/1, HTTP/2, HTTP/3 | Most; H3 varies |
| WebSocket proxying | Most |
| gRPC proxying + transcoding | APISIX standout (HTTP/JSON → gRPC) |
| TCP/UDP proxying | APISIX, Envoy, Kong (limited) |
| Protocol mediation (REST ↔ GraphQL ↔ gRPC) | Tyk, APISIX |
| Canary / blue-green / A/B deployments | Kong, APISIX, Traefik Hub |
| Traffic mirroring | Envoy, Ambassador |
| Ingress controller (Kubernetes native) | Kong, APISIX, Traefik, Envoy |
| East-west (service-to-service) traffic | APISIX, Envoy |
| Service discovery (K8s, Consul, Nomad, DNS) | Traefik strongest; others vary |
| Declarative / GitOps config | Kong (deck), APISIX, Tyk |
| DB-less / stateless mode | Kong, APISIX (standalone mode) |
| Versioning (API versions) | Tyk, Kong |
| Developer portal | Kong (Konnect), Tyk, Traefik Hub |
| API catalog / registry | Kong (Konnect), Tyk |
| Monetization / billing integration | Kong (Konnect), Tyk |
| Admin UI | All major players |
| Multi-tenant / workspace isolation | Kong (Konnect), Tyk |
| Audit logging | Kong, Tyk, APISIX |

### 3.2 Security

| Capability | Notes |
|---|---|
| JWT validation | Table stakes |
| OAuth 2.0 + OIDC | Most; depth varies |
| mTLS (mutual TLS) | Envoy (native), Kong, Tyk |
| WAF (Web Application Firewall) | Traefik Hub, NGINX/F5, AWS |
| IP allowlist/blocklist | Most |
| Bot detection / DDoS mitigation | Cloudflare, Cequence, F5 |
| CORS handling | Most |
| Request size limiting | Most |
| Secret/credential management | Kong (vault), Tyk |
| Zero-trust networking | OpenZiti llm-gateway (niche) |
| SSO / SAML | Kong (Konnect), Tyk, Portkey |

### 3.3 Observability

| Capability | Notes |
|---|---|
| Request logging | Table stakes |
| Metrics export (Prometheus) | Kong, APISIX, Traefik |
| Distributed tracing (OpenTelemetry) | Tyk (native OTel), Kong, APISIX |
| Real-time analytics dashboard | Kong (Konnect), Tyk Dashboard |
| Error rate tracking | Most |
| Latency percentile tracking | Most |
| Alerting | Tyk, Kong (Konnect) |
| BI export (Kafka, S3, Datadog, etc.) | Tyk Pump, Kong |
| Log aggregation integration | Most via plugins |

### 3.4 Plugin / Extension System

| Capability | Notes |
|---|---|
| Traffic pipeline plugins | Kong (Lua/Wasm), APISIX (Lua + multi-lang), Traefik (Wasm) |
| Multi-language plugin support | APISIX: Java, Go, Python, Node.js, Wasm; Kong: Lua, Wasm, Go |
| Plugin hot-reload (no gateway restart) | APISIX, Kong |
| Plugin marketplace / hub | Kong (Plugin Hub), APISIX |
| Admin UI plugin extensions | Tyk AI Studio (gRPC SDK), some Traefik Hub |
| CLI plugin extensions | Limited across all players |
| Plugin sandboxing / isolation | Tyk (isolated gRPC processes), Wasm runtimes |

### 3.5 AI / LLM Gateway

| Capability | Notes |
|---|---|
| **LLM Proxy (multi-provider)** | Kong, APISIX, Tyk, LiteLLM, Portkey, Cloudflare, Traefik |
| **Provider normalization (OpenAI format)** | LiteLLM strongest; Kong, APISIX, Portkey also |
| **Token-based rate limiting** | Kong, APISIX, Tyk, LiteLLM, Portkey, Cloudflare |
| **Token cost tracking** | Kong, Tyk, LiteLLM, Portkey, Cloudflare |
| **Multi-LLM load balancing** | Kong, APISIX, Tyk, LiteLLM |
| **Failover / fallback to backup model** | All major AI gateway players |
| **Semantic routing** (route by prompt meaning) | **Kong only** (as of mid-2025) |
| **Semantic caching** (cache by meaning, not exact text) | **Kong only** |
| **Auto-RAG at gateway layer** | **Kong only** (fully automated); APISIX (manual config) |
| **PII sanitization / redaction** | Kong, Tyk, LiteLLM, Portkey, F5 NGINX |
| **Prompt injection protection** | Kong, Tyk, APISIX, Portkey |
| **Prompt Guard / content filtering** | Kong, Tyk, APISIX, Portkey |
| **Prompt decoration / templating** | APISIX, Tyk |
| **Response filtering / moderation** | Kong, APISIX, Tyk |
| **LLM observability** (TTFT, token counts, latency) | Kong, APISIX, LiteLLM, Portkey |
| **Budget hard caps** | Tyk, LiteLLM, Portkey |
| **Per-team / per-user spend attribution** | Tyk, Kong, LiteLLM, Portkey, Cloudflare |
| **Streaming response support (SSE)** | All major players |
| **MCP server support** | Kong, Tyk, APISIX, Traefik, LiteLLM |
| **MCP auto-generation from REST APIs** | Kong, Tyk |
| **A2A (Agent2Agent) support** | Kong, LiteLLM |
| **Agent identity / scoped tool access** | Tyk, Kong (partial) |
| **Stateful agent sessions (Assistants)** | Kong (Azure/OpenAI Assistants) |
| **Batch LLM execution** | Kong |
| **External guardrails integration** (Bedrock, Azure Content Safety) | Kong |
| **Virtual keys / key management** | LiteLLM, Portkey, Tyk |
| **Developer self-service AI portal** | Tyk AI Studio, Kong (Konnect) |
| **Prompt versioning + approval workflows** | Portkey |

### 3.6 Deployment & Operations

| Capability | Notes |
|---|---|
| Single binary | Traefik, Rioku (target via Caddy) |
| Docker / docker-compose | All |
| Kubernetes native | All major; depth varies |
| Bare metal | All |
| ARM64 support | APISIX, Traefik, Kong |
| Multi-node HA clustering | All major; complexity varies |
| Hybrid (SaaS control plane + on-prem data plane) | Kong (Konnect), Tyk |
| GitOps / IaC support | Kong (deck/Terraform), APISIX, Tyk |
| Zero-downtime config updates | APISIX, Kong, Traefik |
| Config rollback | Kong (deck diff/sync), Tyk |
| Blue-green plugin upgrades | Limited |

---

## 4. Where Rioku Fits

### 4.1 Rioku's Positioning

Rioku is positioned as the **first fully open-source, Caddy-native API + AI gateway platform** that treats AI/agentic workloads as first-class citizens from day one — without paywalling any functional capability.

The gap it fills:
- Kong and Tyk gate critical enterprise features (RBAC, advanced auth, audit logging, developer portal) behind paid tiers
- APISIX is fully open but has no meaningful agentic story, no semantic capabilities, and high ops complexity (etcd, no managed offering)
- Traefik's AI capabilities are thin and its K8s multi-gateway behavior is buggy
- LiteLLM and Portkey are LLM-only — they're not full API gateways
- No player has built agentic-native primitives (agent identity, tool call routing, agentic observability) into an API gateway from the ground up

### 4.2 Primary Differentiators

| Differentiator | Status | Notes |
|---|---|---|
| Caddy foundation (auto-HTTPS, live config, single binary) | ✅ Implemented | No competitor uses Caddy |
| 100% open functional features | ✅ Core philosophy | Kong, Tyk fail here |
| Auto-HTTPS | ✅ Via Caddy | Differentiator vs. Kong, APISIX |
| Single binary distribution | ✅ Via Caddy | Matches Traefik, beats Kong/APISIX ops complexity |
| Plugin-extensible at every layer (traffic, CLI, admin UI, middleware) | ✅ Architecture implemented | Plugin stubs exist, full plugin lifecycle not yet wired |
| Agentic observability (multi-step traces, agent session correlation) | ✅ TraceStore + proto implemented | gRPC server registration in progress |
| Agent identity + scoped tool access (first-class) | 🔲 Stub only | No player does this well |
| Tool call routing (MCP/function-calling policy per-tool) | 🔲 Stub only | Nascent in Kong, Tyk; not from the ground up |
| Semantic rate limiting (token-aware, not request-count) | 🔲 Stub only | Kong does this; others don't |
| LLM proxy + routing (at parity with Kong) | 🔲 Stub only | Needed for credibility |
| Prompt/response policy middleware | 🔲 Not started | Most players have this |

### 4.3 Features to Deprioritize (v1)

- Semantic routing (complex ML infrastructure; Kong's clearest moat — address later)
- Semantic caching (same infrastructure dependency)
- Auto-RAG (requires vector DB integration; add as community module)
- Service mesh / east-west sidecar (not the primary use case)
- Managed cloud offering (post-launch)

### 4.4 Competitive Risk Map

| Risk | Source | Mitigation |
|---|---|---|
| Kong adds full OSS parity | Low probability — their revenue depends on enterprise gating | Community momentum before they react |
| APISIX adds agentic primitives | Possible — Apache project, fast release cadence | Ship first; APISIX has no product org to market against |
| Tyk AI Studio matures rapidly | Active — they're building fast | Differentiate on Caddy UX and open philosophy |
| LiteLLM expands to full API gateway | Possible but Python foundation limits throughput | Go advantage is real; different target user |
| New entrant (funded AI gateway startup) | Real risk | OSS community lock-in; shipping velocity |

---

## 5. Key References

- [Kong AI Gateway Docs](https://developer.konghq.com/ai-gateway/)
- [Tyk AI Studio](https://tyk.io/tyk-ai-studio/) | [Tyk AI Studio GitHub](https://github.com/TykTechnologies/ai-studio)
- [Apache APISIX AI Gateway](https://apisix.apache.org/ai-gateway/)
- [Traefik Product Features](https://doc.traefik.io/traefik/features/)
- [LiteLLM Docs](https://docs.litellm.ai/docs/)
- [Portkey](https://portkey.ai/)
- [Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/)
- [Kong vs Portkey vs LiteLLM Benchmark](https://konghq.com/blog/engineering/ai-gateway-benchmark-kong-ai-gateway-portkey-litellm)
- [AI Gateway Deep Dive (Jimmy Song, 2025)](https://jimmysong.io/blog/ai-gateway-in-depth/)
- [Gateway API Benchmarks](https://github.com/howardjohn/gateway-api-bench)
