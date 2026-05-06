# Decisions needed (plan-06 notifications worktree)

> Filed during stage-2 Plan 06 wiring. The orchestrator's `make decisions-sync`
> will merge these into `contrib-docs/stage2-master-decisions.md` on PR merge.

## Item 001 — Notification dispatcher (channel send-side) deferred

- **Status:** RESOLVED (2026-05-06)
- **Filed by:** plan-06 (stage2/plan-06-notifications), 2026-05-06
- **Category:** scope-question
- **What:** The plan envisions a real notification dispatcher that consumes
  routing rules and sends to channels (email via SMTP/`auth.Mailer`, slack/
  webhook later). The existing `packages/daemon/internal/notifications/
  dispatcher.go` is a webhook fan-out for api-management state-change events
  (#164 sprint-4) — it does not understand notification channels or routing
  rules.
- **Found in:** `packages/daemon/internal/notifications/dispatcher.go`
  (webhook fan-out), `packages/daemon/internal/gateway/notifications_routes.go`
  L570 `handleTestChannel` (stub).
- **Why it matters:** Without a channel-side dispatcher: (a) the "Send test"
  button on each channel returns a stub `ok=true` instead of producing an
  actual outbound email/slack message; (b) routing rules are persisted but
  never evaluated server-side, so user-facing notification behaviour is
  identical to the inbox-only path delivered in T2. The UI is fully wired
  (CRUD + reorder + preview) but does not drive real delivery.
- **Recommendation:** Treat the channel dispatcher as a separate plan
  (e.g. plan-06b "channel dispatcher + email") sized at ~3-5 days. Required
  scope:
    1. New `internal/notifications/channels/` package with `Channel`
       interface and `Email` implementation backed by `auth.Mailer` (or a
       new `SMTPClient` if `auth.Mailer` is too narrow).
    2. New dispatcher loop in `internal/notifications/channel_dispatcher.go`
       that consumes inbox events, evaluates `notification_routing_rules`
       (start with prefix/exact/key=value matchers — full CEL deferred),
       fans out to enabled channels, writes a `notification_log` entry per
       attempt, and retries with backoff per the tenant config's
       `MaxRetries` / `RetryBackoffSeconds`.
    3. Wire `handleTestChannel` to enqueue a synthetic test event through
       the same dispatcher path.
    4. Sandbox: add mailpit (or reuse existing) and verify smoke smoke.
- **Alternatives:** Ship channel dispatcher as part of plan-06's PR by
  scope-creeping the worktree — rejected for risk and PR diff size.
- **User decision:** Resolved in-worktree as a follow-up commit on
  stage2/plan-06-notifications rather than splitting into plan-06b. Scope
  delivered: `internal/notifications/channel.go` (Channel interface +
  Message envelope + ErrPermanent helpers), `email_channel.go`
  (net/smtp-backed sender with stubbable Sender seam, RFC822 builder,
  permanent-vs-transient SMTP error classification), `webhook_channel.go`
  (HTTP POST with canonical envelope, 4xx-vs-5xx classification), plus
  `slack_channel.go` (incoming-webhook adapter). `dispatcher_send.go`
  defines `ChannelDispatcher` with retry + exponential backoff,
  delivery-log writes per attempt, and an env-driven default SMTP
  fallback (`RIOKU_SMTP_HOST` / `RIOKU_SMTP_PORT`, defaulting to
  localhost:1025 for sandbox/mailpit). `handleTestChannel` now resolves
  the stored channel, runs one dispatch, returns `{ok, deliveredAt}` on
  success or 502 + problem-detail on failure. CEL evaluation of routing
  rules remains future work but the channel send-side is no longer a
  stub. Sandbox seed gains a `mailpit-sandbox` email channel.
- **Resolution date / commit:** 2026-05-06, on stage2/plan-06-notifications

## Item 002 — Cross-feature mock-store reads in detail components

- **Status:** RESOLVED (2026-05-06) — deferred per recommendation; tracked
  as plan-06 follow-up before the `VITE_USE_MOCKS=false` flip. The
  supplemental panels degrade to empty-state in real-daemon mode without
  blocking CRUD; audit-by-resource ownership remains with Plan 5 close-out
  per the recommendation in this entry.
- **Filed by:** plan-06 (stage2/plan-06-notifications), 2026-05-06
- **Category:** scope-question
- **What:** The notification-channel `detail.tsx` reads delivery-log + audit
  entries from `useMockStore`; the routing-rule `detail.tsx` and `form.tsx`
  read channel records from `useMockStore`; `notification-log/components/
  detail.tsx` reads notifications from `useMockStore`. The api.ts files have
  been migrated to the daemon, so these direct store reads will silently
  return empty arrays once `VITE_USE_MOCKS=false` flips.
- **Found in:**
  - `packages/web/src/features/notification-channels/components/detail.tsx`
    (deliveryLog + audit reads)
  - `packages/web/src/features/notification-channels/components/list.tsx`
    (24h delivery counts)
  - `packages/web/src/features/notification-routing/components/detail.tsx`
    (channels + audit + delivery-log reads)
  - `packages/web/src/features/notification-routing/components/form.tsx`
    (channel multi-select source)
  - `packages/web/src/features/notification-routing/components/list.tsx`
    (channel name lookup)
  - `packages/web/src/features/notification-log/components/detail.tsx`
    (notification title lookup)
- **Why it matters:** The supplemental panels (recent deliveries, audit
  tail, channel multi-select options) will display empty state in real-
  daemon mode. CRUD itself works correctly. Audit-by-resource is owned by
  Plan 5 (audit) and is a known cross-cutting dependency.
- **Recommendation:** Plan 5 close-out should expose
  `useAuditByResource(type, id)` and the channel/routing detail panels
  should switch to it. The "channels" multi-select in routing-rule form
  should switch to the channel-list query (`useChannelList(tenantId,
  emptyFilter())`). The 24h delivery count on the channel list can be
  derived from the same `useDeliveryLogList` query the delivery-log page
  already drives. None of this is hard, but each touch widens the PR; the
  recommendation is to land it as plan-06's follow-up commit immediately
  after this PR merges, before the master `VITE_USE_MOCKS=false` flip.
- **Alternatives:** Land the component refactors in this PR (~150 LOC of
  diff, cross-cuts 6 files) — viable but lengthens review.
- **User decision:** Deferred to follow-up commit per recommendation.
- **Resolution date / commit:** 2026-05-06, on stage2/plan-06-notifications

## Item 003 — Audit emission → event router → channel fan-out wiring

- **Status:** RESOLVED (2026-05-06)
- **Filed by:** plan-06 (stage2/plan-06-notifications), 2026-05-06
- **Category:** integration
- **What:** The channel send-side dispatcher (item 001) was wired only via
  the `handleTestChannel` REST endpoint. Real audit emissions did not
  trigger routing-rule evaluation, so notification routing rules were
  inert in normal traffic.
- **Resolution:** Added `internal/notifications/event_router.go` (LoadRules,
  EvaluateAndDispatch, AsyncEvaluateAndDispatch, MatchesFilter, plus a
  `MakeConfigAuditDispatchFn` adapter). The config engine now exposes
  `SetAuditDispatcher(AuditEventDispatchFn)` and fires the closure after
  every successful `AppendAuditEntry` commit. EventFilter grammar matches
  the web UI's `<category>.<subtype>` pattern (with `*` wildcards plus a
  severity fallback) — no `cel-go` dependency was added. Tests:
  `event_router_test.go` covers matching, non-matching, malformed, no-rule,
  disabled-rule, async-non-blocking, and the config-adapter dispatch fn.
- **Resolution date / commit:** 2026-05-06, on stage2/plan-06-notifications
