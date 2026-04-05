# Rioku — Commercial Strategy, Community & Development Plan

**Version:** 0.1
**Status:** Working Notes
**Last Updated:** 2026-04-02

---

## 1. Context & Constraints

- Solo developer, stable unrelated day job
- Infrastructure expertise, powerful homelab for testing
- AI-assisted coding (limited Go and frontend experience)
- Pessimistic planning disposition — plan against the hard case
- Full-time commitment only if project demonstrates real traction
- No runway pressure — this is an asset being built, not a startup burning cash

---

## 2. Commercial Model

### Core Position

Apache 2.0 for everything in the core daemon and first-party modules. No feature paywalling. Services and support are the commercial layer — never features.

### Why Enterprise Sales Is Off The Table Early

Enterprise sales requires people: sales calls, security reviews, contracts, support SLAs. This cannot be done alongside a full-time job. Enterprise revenue is a Phase 6+ conversation, not an early funding model.

Support contracts are also a trap for solo maintainers — five paying support customers means a second job with an SLA. Avoid until full-time.

### Realistic Revenue Progression

| Timeframe | Model | Realistic Monthly Revenue |
|--|--|--|
| Months 1–12 | Zero. Investment phase. | $0 |
| Months 12–18 | GitHub Sponsors | $500–2,000 |
| Months 18–26 | Hosted build service | $2,000–5,000 |
| Months 26–36 | Consulting / implementation | $5,000–15,000 |
| Full-time eval | Month 36 — assess based on real data | — |

### Commercial Offerings (In Priority Order)

#### 1. Hosted Build Service (Phase 4 Launch — Month 26)

The most natural first commercial product given the architecture. Operators who don't want to run Go toolchain on their servers pay for a managed build service.

- Already designed as a standalone separate service
- Low operational complexity relative to full managed hosting
- Clear, discrete value proposition
- Pricing target: $20–50/month per deployment
- 50–100 paying customers = meaningful early revenue

#### 2. GitHub Sponsors (Phase 1 Launch — Month 7)

Set up alongside the public alpha. Companies using Rioku in production will sponsor if framed correctly. Not a living wage — meaningful signal and supplementary cash.

#### 3. Consulting / Implementation (Opportunistic)

You become the world's foremost Rioku expert by building it. Day-rate consulting fits around a day job better than ongoing support contracts. Accept selectively — protect building time.

#### 4. Managed Cloud Hosting (Phase 6+, Full-Time Only)

Run Rioku as a service. Low sales friction, recurring revenue. Deferred because: infrastructure costs, support burden, different skillset. Not viable part-time.

#### 5. Enterprise Support Contracts (Phase 6+, Full-Time Only)

SOC2, SLAs, security reviews, dedicated support. Cannot be responsibly sold part-time. Revisit at Month 36.

### Things To Decide Before Public Launch

- **USPTO trademark clearance for "Rioku"** — required before any public launch or marketing spend. Noted in design doc as pending.
- **Pricing page** — even a simple one. Signals the project is serious about sustainability.
- **Entity formation** — sole proprietorship is fine initially; LLC before first commercial customer.

---

## 3. Community Infrastructure

### Set Up Before First Public Commit

**GitHub org: `riokulabs`**
Not your personal account. Establishes the project as independent from any individual. Easier to add contributors later. Repo: `riokulabs/rioku`.

**Discord**
Not Slack — Slack free tier deletes message history, destroying community knowledge. Discord is free, persistent, and where developers are.

Initial channel structure (keep it minimal):
- `#announcements` — releases, major updates (low volume)
- `#general` — open discussion
- `#help` — support questions
- `#plugin-dev` — plugin development discussion
- `#contributing` — PRs, issues, project direction

Do not create channels you won't actively monitor. Empty channels signal abandonment.

**`SECURITY.md` in repo**
Private vulnerability disclosure via `security@rioku.dev` before first public release. Costs nothing. Signals maturity. A CVE in a gateway that wasn't handled responsibly is reputationally fatal.

**`CONTRIBUTING.md` in repo**
How to submit PRs, code style, commit message format (Conventional Commits), how decisions get made. Write it as if you expect contributors even before you have any.

**`CHANGELOG.md`**
Updated with every release. Follow Keep a Changelog format (`https://keepachangelog.com`). Non-negotiable for infrastructure software — operators need to know what changed before upgrading.

### Set Up At Public Alpha Launch (Month 7)

**Discourse forum** (self-host on homelab or $100/month hosted)
For long-form, searchable knowledge that outlasts Discord. GitHub Discussions is an acceptable substitute if you want zero ops initially.

**GitHub Sponsors page**
Set up at the same time as public launch. Frame it as sustaining development, not charity.

**`plugins.rioku.dev` registry**
Git-backed JSON manifest. Self-hostable. No binary hosting in v1. Ready at Phase 4.

### What NOT To Set Up Yet

- Twitter/X — post when you have something to show
- Blog — write when you have something to say
- Mailing list — Discord covers this initially
- Roadmap tool — GitHub Projects is sufficient
- Anything requiring ongoing maintenance before you have users

---

## 4. The Quiet Launch Strategy

**Do not post to Hacker News until Phase 2 is solid (Month 12).**

Launch Phase 1 publicly but without fanfare. Put the repo public, open Discord, but don't drive traffic. Early users who find it organically are self-selecting for tolerance of rough edges — they become your early community rather than your early critics.

A premature HN post with rough software produces: flood of bug reports, frustrated Discord messages, negative comments that follow the project's search results for years. Early reputation is sticky in both directions.

**Show HN post target: Phase 2 complete, Month 12–13.**

---

## 5. Realistic Timeline

### Pessimistic (Plan Against This)

**Months 1–2:** Slower than expected. Go toolchain setup, understanding Caddy internals, AI-generated code with subtle bugs in concurrent parts. Store driver interface rewritten twice.

**Months 3–6:** Phase 1 takes longer than planned. Caddy process management is finicky. AI-generated gRPC server code has connection leak issues taking a week to debug. SPA is actually fine — SvelteKit with AI assistance works well.

**Months 6–9:** Phase 1 working but rough. Quiet public repo. 200 GitHub stars, 3 Discord members, one bug filed. Motivation dip. **This is the graveyard of open source projects.** You push through because you have stable income and don't need it to succeed immediately.

**Months 9–18:** Postgres store works. A few people start using it seriously. First external PR. Motivation returns.

**Months 18–24:** Multi-node is harder than designed. Distributed systems bugs appearing only under specific network partition conditions. Need a Go developer to review cluster sync code — either hire for review, or find a contributor.

**Months 24–36:** Project is real. Not huge, but used. 1000+ GitHub stars, small active Discord, handful of known production deployments. Hosted build service live, modest revenue.

**Full-time decision: Month 36–48.** Not before.

### Milestone Table

| Phase | Goal | Target Month | Success Signal |
|--|--|--|--|
| 0 | Skeleton compiles, all interfaces locked | 2 | `go build` passes, proto generates clean |
| 1 | Single node proxies HTTP traffic | 6 | Proxying homelab traffic through Rioku |
| 1.5 | Public alpha, repo open, Discord open | 7 | Repo public, no fanfare |
| 2 | Production-grade single node | 12 | Would trust it in front of a real service |
| 2.5 | Show HN launch | 13 | HN post, Hacker News community feedback |
| 3 | Multi-node on homelab | 18 | 3-node homelab cluster survives chaos testing |
| 4 | Plugin ecosystem + Terraform provider | 24 | External developer writes and installs a plugin |
| 4.5 | Hosted build service (first commercial) | 26 | First paying customer |
| 5 | AI/agentic features, MCP server | 30 | Claude agent manages Rioku config via MCP |
| 6 | Enterprise features | 36 | First enterprise conversation |
| — | Full-time evaluation | 36 | Assess revenue trend, user growth, community health |

---

## 6. What Would Kill This Project

**Maintenance burden from a premature public launch.** A flood of bug reports from a rough Phase 1 HN post creates negative search results that follow the project forever. Solution: quiet launch at Phase 1, show HN at Phase 2.

**Motivation loss at the Phase 1 → 2 graveyard.** The point where it works but nobody is using it yet. Solution: stable income removes the existential pressure; homelab gives you a real user (yourself).

**Distributed systems bugs in Phase 3.** The cluster sync and Galera code cannot be AI-coded without careful review. Solution: budget time for a Go code review from a specialist before the multi-node release, either paid or via community.

**Security incident without a response process.** A CVE in a gateway product is severe. Solution: SECURITY.md and responsible disclosure process in place before first public commit.

**Scope creep before Phase 2.** The feature list is long and compelling. Building Phase 5 features before Phase 2 is solid produces software that does many things poorly. Solution: strict phase gates — nothing from Phase N+1 starts until Phase N milestone is met.

---

## 7. Enterprise Considerations (Defer to Phase 6)

Document now, implement later:

- **Vault keyring backend** — enterprises use HashiCorp Vault, AWS Secrets Manager, Azure Key Vault. Keyring interface already designed to support this.
- **Multi-tenancy** — reserve `namespace`/`tenant_id` column space in schema now. Implement later.
- **SSO/SAML/OIDC** — plugin architecture already supports this. Okta, Azure AD, Google Workspace.
- **SIEM export** — structured audit events to Splunk, Datadog, Elastic.
- **Change approval workflows** — four-eyes principle for config changes. `pending_changes` state in config system.
- **SOC2 compliance documentation** — audit log completeness, access controls, encryption at rest evidence.
- **Air-gap deployment validation** — test suite that verifies zero external network calls.

None of these are Phase 0–4 work. Reserve schema space where noted. Document the intent. Build when there are enterprise users to validate with.
