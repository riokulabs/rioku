# Decisions needed (plan-06 notifications worktree)

> Filed during stage-2 Plan 06 wiring. The orchestrator's `make decisions-sync`
> will merge these into `contrib-docs/stage2-master-decisions.md` on PR merge.

## Item 001 — Notification dispatcher (channel send-side) deferred

- **Status:** open
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
- **User decision:** [pending]
- **Resolution date / commit:** [pending]

## Item 002 — Cross-feature mock-store reads in detail components

- **Status:** open
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
- **User decision:** [pending]
- **Resolution date / commit:** [pending]
