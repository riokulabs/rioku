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

### Traffic & Security

| Module | Repo | Stars | License | Purpose | Competitive Gap Closed |
|---|---|---|---|---|---|
| `http.handlers.waf` | `corazawaf/coraza-caddy` | 601 | Apache-2.0 | OWASP WAF with Core Rule Set | Kong/Traefik paywall WAF; APISIX/Tyk have none |
| `layer4` | `mholt/caddy-l4` | 1,607 | Apache-2.0 | TCP/UDP/TLS proxying | APISIX TCP/UDP; Traefik TCP/UDP |
| `http.handlers.cache` | `caddyserver/cache-handler` | 376 | Apache-2.0 | RFC-7234 HTTP response cache | All competitors have response caching |
| `http.handlers.grpc_web` | `mholt/caddy-grpc-web` | 32 | Apache-2.0 | gRPC-Web to gRPC translation | APISIX/Kong/Envoy gRPC support |
| `security` | `greenpau/caddy-security` | 2,119 | Apache-2.0 | OIDC/OAuth2/SAML/MFA auth | Kong/Traefik paywall enterprise auth |
| `http.handlers.proxyprotocol` | `mastercactapus/caddy2-proxyprotocol` | 66 | MIT | PROXY protocol v1/v2 support | Real client IP behind AWS ALB/NLB, GCP LB, HAProxy |

> **Note:** `kirsch33/realip` was previously listed here but has been removed. Caddy v2.7+ provides native `trusted_proxies` with `{client_ip}` placeholder support, which fully replaces it. Rioku's Caddy config generator should set `trusted_proxies` directly.

### DNS Provider (ACME DNS-01)

Cloudflare is bundled by default — it covers ~40% of authoritative DNS hosting globally with negligible binary impact (thin REST wrapper, no vendor SDK). This gives most users wildcard TLS out of the box without requiring `rku plugin install` before their first wildcard cert.

| Module | Repo | Stars | License | Purpose | Dep Weight |
|---|---|---|---|---|---|
| `dns.providers.cloudflare` | `caddy-dns/cloudflare` | 882 | MIT | Cloudflare DNS-01 challenges | Light (no vendor SDK) |

Cloudflare can be removed via `rku plugin remove dns-cloudflare` if not needed. Additional DNS providers are available as optional installs (see Section 3).

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

### General

| Module | Repo | Stars | Install Command | Use Case |
|---|---|---|---|---|
| `http.handlers.forward_proxy` | `caddyserver/forwardproxy` | 701 | `rku plugin install forward-proxy` | Edge deployments, egress control |
| `http.handlers.maxmind_geolocation` | `porech/caddy-maxmind-geolocation` | 204 | `rku plugin install geo-maxmind` | Geo-based routing/blocking |
| `http.handlers.crowdsec` | `hslatman/caddy-crowdsec-bouncer` | 349 | `rku plugin install crowdsec` | CrowdSec threat intelligence |
| `http.handlers.defender` | `JasonLovesDoggo/caddy-defender` | 512 | `rku plugin install ai-defender` | AI crawler blocking |
| `caddy.logging.encoders.transform` | `caddyserver/transform-encoder` | 111 | `rku plugin install transform-encoder` | Custom log formats for SIEM |
| `pberkel/caddy-storage-redis` | `pberkel/caddy-storage-redis` | 88 | `rku plugin install storage-redis` | Shared TLS cert storage (Valkey/Redis) |

### Additional DNS Providers

Cloudflare is bundled by default (see Section 2). All other providers are optional installs. Cloud provider SDKs (Route53, GCP, Azure) add significant binary weight (+3-10MB each).

| Module | Repo | Stars | Install Command | Use Case |
|---|---|---|---|---|
| `dns.providers.route53` | `caddy-dns/route53` | 75 | `rku plugin install dns-route53` | AWS Route 53 |
| `dns.providers.googleclouddns` | `caddy-dns/googleclouddns` | 17 | `rku plugin install dns-googlecloud` | Google Cloud DNS |
| `dns.providers.azure` | `caddy-dns/azure` | 12 | `rku plugin install dns-azure` | Azure DNS |
| `dns.providers.digitalocean` | `caddy-dns/digitalocean` | 53 | `rku plugin install dns-digitalocean` | DigitalOcean DNS |
| `dns.providers.hetzner` | `caddy-dns/hetzner` | 61 | `rku plugin install dns-hetzner` | Hetzner DNS (popular in EU) |
| `dns.providers.acmedns` | `caddy-dns/acmedns` | 66 | `rku plugin install dns-acmedns` | Universal DNS-01 fallback via CNAME delegation |
| `dns.providers.porkbun` | `caddy-dns/porkbun` | — | `rku plugin install dns-porkbun` | Porkbun registrar DNS |
| `dns.providers.namecheap` | `caddy-dns/namecheap` | — | `rku plugin install dns-namecheap` | Namecheap registrar DNS |
| `dns.providers.duckdns` | `caddy-dns/duckdns` | — | `rku plugin install dns-duckdns` | DuckDNS (home lab / self-hosting) |
| `dns.providers.alidns` | `caddy-dns/alidns` | — | `rku plugin install dns-alidns` | Alibaba Cloud DNS |
| `dns.providers.dnspod` | `caddy-dns/dnspod` | — | `rku plugin install dns-dnspod` | DNSPod (Tencent) |
| `dns.providers.tencentcloud` | `caddy-dns/tencentcloud` | — | `rku plugin install dns-tencentcloud` | Tencent Cloud DNS |

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

> **Status key:** "Package only" = Go package declaration exists (2-5 lines), no logic. "Not started" = no directory exists. Also present: `rioku-vars` (44 lines, functional — provides Caddy placeholders for Rioku metadata).

### Phase 1-2 (Core Gateway)

| Plugin | Type | Competitive Match | Status |
|---|---|---|---|
| **auth-jwt** | Middleware | All competitors | Package only |
| **auth-apikey** | Middleware | All competitors | Package only |
| **rate-limit** | Traffic | Kong, APISIX, Tyk (token-aware) | Package only |
| **transform** | Traffic | Kong, Tyk, APISIX | Package only |
| **rioku-vars** | Middleware | Internal | Functional (44 lines) |
| **circuit-breaker** | Traffic | Kong, APISIX, Traefik | Not started |
| **cors** | Middleware | All competitors (table stakes) | Not started |
| **ip-filter** | Config-layer | All competitors | Config wraps Caddy `remote_ip` matcher |

### Phase 3-4 (Advanced Gateway)

| Plugin | Type | Competitive Match | Status |
|---|---|---|---|
| **canary** | Traffic | Kong, APISIX, Traefik Hub | Not started |
| **traffic-mirror** | Traffic | Envoy, Ambassador | Not started |
| **grpc-transcode** | Traffic | APISIX (standout), Envoy | Not started |
| **oidc** | Middleware | Kong (paywalled), Tyk, Traefik Hub | Not started (replaces caddy-security bridge) |

### Phase 5-6 (AI/Agentic)

| Plugin | Type | Competitive Match | Status |
|---|---|---|---|
| **llm-proxy** | Traffic | Kong, APISIX, Tyk, LiteLLM, Portkey | Package only |
| **agent-identity** | Middleware | Tyk (partial), Kong (partial) | Package only |
| **tool-router** | Traffic | Kong MCP, Tyk MCP | Package only |
| **pii-redact** | Middleware | Kong (20+ categories), Tyk, F5 | Not started |
| **prompt-guard** | Middleware | Kong, Tyk, APISIX, Portkey | Not started |
| **mcp-gateway** | Traffic | Kong, Tyk, APISIX, Traefik | Not started (design in ai-and-agentic.md) |

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
| Wildcard TLS (DNS-01) | Plugin | Plugin | Plugin | Plugin | **Default (Cloudflare), 11 optional** |
| Token rate limiting | Enterprise | Plugin | AI Studio | None | **First-party** |
| LLM proxy | AI Gateway | Plugin | AI Studio | AI Gateway | **First-party** |
| Zero-dep clustering | None | None | None | None | **First-party (unique)** |
| WASM plugins | Removed (3.11) | Limited | None | WASM | **First-party** |

**Key differentiator:** Every feature in the table above is free and open source in Rioku. Kong and Traefik paywall WAF, OIDC, and advanced rate limiting. APISIX requires etcd. Tyk requires Redis. Rioku ships as a single binary with zero external dependencies.
