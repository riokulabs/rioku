# Rioku — Caddy Plugin Strategy

**Version:** 1.0
**Date:** 2026-04-06
**Status:** Approved

---

## 1. Overview

Rioku ships a custom Caddy build that includes community plugins for functionality better handled by the ecosystem, and first-party traffic plugins for capabilities that require deep integration with Rioku's config store, policy system, and AI pipeline.

**Principle:** Use community plugins for commodity capabilities (WAF, L4 proxying, HTTP caching). Build first-party for anything that needs Rioku integration (rate limiting, LLM proxy, auth policies, transformations).

---

## 2. Default Caddy Build (Community Plugins)

These ship in every Rioku Caddy binary. Selected because they close competitive gaps, are actively maintained, and don't conflict with Rioku's first-party plugins.

| Module | Repo | Stars | License | Purpose | Competitive Gap Closed |
|---|---|---|---|---|---|
| `http.handlers.waf` | `corazawaf/coraza-caddy` | 601 | Apache-2.0 | OWASP WAF with Core Rule Set | Kong/Traefik paywall WAF; APISIX/Tyk have none |
| `layer4` | `mholt/caddy-l4` | 1,607 | Apache-2.0 | TCP/UDP/TLS proxying | APISIX TCP/UDP; Traefik TCP/UDP |
| `http.handlers.cache` | `caddyserver/cache-handler` | 376 | Apache-2.0 | RFC-7234 HTTP response cache | All competitors have response caching |
| `http.handlers.grpc_web` | `mholt/caddy-grpc-web` | 32 | Apache-2.0 | gRPC-Web to gRPC translation | APISIX/Kong/Envoy gRPC support |
| `security` | `greenpau/caddy-security` | 2,119 | Apache-2.0 | OIDC/OAuth2/SAML/MFA auth | Kong/Traefik paywall enterprise auth |

### caddy-security Configuration

caddy-security is included as an **auth middleware bridge** until Rioku builds first-party OIDC/OAuth2. It must be configured in middleware-only mode:
- Token validation (OIDC, JWT, OAuth2) — ENABLED
- Portal UI — DISABLED (conflicts with Rioku admin panel)
- Built-in user database — DISABLED (Rioku owns identity via config store)
- MFA — DISABLED (will be part of first-party auth)

This plugin will be removed from the default build once first-party OIDC is implemented.

---

## 3. Optional Plugins (User Installs)

Available via `rku plugin install <name>`. Not in the default build to keep binary size down.

| Module | Repo | Stars | Install Command | Use Case |
|---|---|---|---|---|
| `http.handlers.forward_proxy` | `caddyserver/forwardproxy` | 701 | `rku plugin install forward-proxy` | Edge deployments, egress control |
| `dns.providers.cloudflare` | `caddy-dns/cloudflare` | 878 | `rku plugin install dns-cloudflare` | Wildcard TLS via DNS-01 |
| `dns.providers.route53` | `caddy-dns/route53` | 75 | `rku plugin install dns-route53` | AWS wildcard TLS via DNS-01 |
| `http.handlers.maxmind_geolocation` | `porech/caddy-maxmind-geolocation` | 204 | `rku plugin install geo-maxmind` | Geo-based routing/blocking |
| `http.handlers.crowdsec` | `hslatman/caddy-crowdsec-bouncer` | 349 | `rku plugin install crowdsec` | CrowdSec threat intelligence |
| `http.handlers.defender` | `JasonLovesDoggo/caddy-defender` | 512 | `rku plugin install ai-defender` | AI crawler blocking |
| `http.handlers.realip` | `kirsch33/realip` | 45 | `rku plugin install realip` | Extract real client IP from X-Forwarded-For behind proxies |
| `http.handlers.proxyprotocol` | `mastercactapus/caddy2-proxyprotocol` | 66 | `rku plugin install proxy-protocol` | PROXY protocol v1/v2 (AWS ALB/NLB, GCP LB, Cloudflare) |
| `caddy.logging.encoders.transform` | `caddyserver/transform-encoder` | 111 | `rku plugin install transform-encoder` | Custom log formats for SIEM |
| `pberkel/caddy-storage-redis` | `pberkel/caddy-storage-redis` | 88 | `rku plugin install storage-redis` | Shared TLS cert storage (Valkey/Redis) |

Additional DNS providers available: digitalocean, hetzner, porkbun, namecheap, alidns, acmedns, dnspod, tencentcloud.

---

## 4. Skipped Community Plugins

These were evaluated and explicitly rejected. Use the stated first-party replacement instead.

| Community Plugin | Why Skipped | First-Party Replacement |
|---|---|---|
| `mholt/caddy-ratelimit` | Only does request-count limiting. Rioku needs token-aware semantic rate limiting integrated with policies and AI pricing | `rate-limit` plugin |
| `caddyserver/replace-response` | Response transformation must integrate with Rioku's policy binding system | `transform` plugin |
| `chukmunnlee/caddy-openapi` | 30 stars, low adoption. OpenAPI validation should integrate with Rioku's config store | Build when needed |
| `dunglas/vulcain` | No competitive relevance. HTTP/2 push deprecated in browsers | Not needed |

---

## 5. First-Party Plugin Roadmap

These capabilities have NO community Caddy plugin and MUST be built by Rioku. Ordered by competitive priority.

### Phase 1-2 (Core Gateway)

| Plugin | Type | Competitive Match | Status |
|---|---|---|---|
| **auth-jwt** | Middleware | All competitors | Stub exists |
| **auth-apikey** | Middleware | All competitors | Stub exists |
| **rate-limit** | Traffic | Kong, APISIX, Tyk (token-aware) | Stub exists |
| **transform** | Traffic | Kong, Tyk, APISIX | Stub exists |
| **circuit-breaker** | Traffic | Kong, APISIX, Traefik | Needs stub |
| **cors** | Middleware | All competitors (table stakes) | Needs stub |
| **ip-filter** | Config-layer | All competitors | Config wraps Caddy `remote_ip` matcher |

### Phase 3-4 (Advanced Gateway)

| Plugin | Type | Competitive Match | Status |
|---|---|---|---|
| **canary** | Traffic | Kong, APISIX, Traefik Hub | Needs stub |
| **traffic-mirror** | Traffic | Envoy, Ambassador | Needs stub |
| **grpc-transcode** | Traffic | APISIX (standout), Envoy | Needs stub |
| **oidc** | Middleware | Kong (paywalled), Tyk, Traefik Hub | Replaces caddy-security bridge |

### Phase 5-6 (AI/Agentic)

| Plugin | Type | Competitive Match | Status |
|---|---|---|---|
| **llm-proxy** | Traffic | Kong, APISIX, Tyk, LiteLLM, Portkey | Stub exists |
| **agent-identity** | Middleware | Tyk (partial), Kong (partial) | Stub exists |
| **tool-router** | Traffic | Kong MCP, Tyk MCP | Stub exists |
| **pii-redact** | Middleware | Kong (20+ categories), Tyk, F5 | Needs stub |
| **prompt-guard** | Middleware | Kong, Tyk, APISIX, Portkey | Needs stub |
| **mcp-gateway** | Traffic | Kong, Tyk, APISIX, Traefik | Partially designed |

### Deprioritized (Post-v1)

| Capability | Competitor | Reason |
|---|---|---|
| Semantic routing | Kong only | Complex ML infrastructure; Kong's moat |
| Semantic caching | Kong only | Same infrastructure dependency |
| Auto-RAG at gateway | Kong only | Requires vector DB; add as community module |
| Developer portal | Kong, Tyk (paywalled) | Admin panel serves operators first |

---

## 6. Caddy Download & Build Pipeline

The `rku init` command downloads a pre-built Caddy binary with default plugins compiled in. The download URL includes platform detection and the `User-Agent: Rioku/<version> (github.com/riokulabs/rioku)` header.

When users install optional plugins (`rku plugin install <name>`), the build service recompiles Caddy with the additional modules via xcaddy. This is the same pattern as the current Caddy download page.

**Build service flow:**
1. User runs `rku plugin install forward-proxy`
2. CLI sends request to build service (local xcaddy or hosted)
3. Build service runs `xcaddy build --with <module>`
4. New binary is downloaded and hot-swapped (zero-downtime Caddy replacement)

---

## 7. Competitive Position After Plugin Strategy

With the default build + Phase 1-2 first-party plugins, Rioku matches or exceeds competitors on:

| Capability | Kong | APISIX | Tyk | Traefik | Rioku |
|---|---|---|---|---|---|
| WAF | Enterprise | None | None | Enterprise | **Default (free)** |
| OIDC/OAuth2 | Enterprise | Plugin | Enterprise | Enterprise | **Default (free)** |
| L4 TCP/UDP | Limited | Native | None | Native | **Default** |
| Response cache | Plugin | Plugin | Plugin | None | **Default** |
| gRPC-Web | Plugin | Plugin | Plugin | None | **Default** |
| Token rate limiting | Enterprise | Plugin | AI Studio | None | **First-party** |
| LLM proxy | AI Gateway | Plugin | AI Studio | AI Gateway | **First-party** |
| Zero-dep clustering | None | None | None | None | **First-party (unique)** |
| WASM plugins | Removed (3.11) | Limited | None | WASM | **First-party** |

**Key differentiator:** Every feature in the table above is free and open source in Rioku. Kong and Traefik paywall WAF, OIDC, and advanced rate limiting. APISIX requires etcd. Tyk requires Redis. Rioku ships as a single binary with zero external dependencies.
