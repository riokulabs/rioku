# D6: Audit Log Shape — Per-Action Structured Schema, Not Generic Before/After Diff

**Date**: 2026-04-30
**Issue**: #182
**Status**: Accepted

## Context

Audit logging today is fragmented across three sources:

1. **`audit_log` table** — admin actions (config CRUD, role changes,
   API-key operations) with a generic `(actor, entity_type,
   entity_id, operation, diff)` shape. The `diff` column is a JSON
   blob whose structure varies by `operation`.
2. **Raft FSM events (#53)** — leader changes, snapshot creation,
   replication state transitions. Tracked separately in Raft's own
   logs, not surfaced through the audit API.
3. **Caddy certificate lifecycle (#77, #125)** — issuance, renewal,
   revocation, ACME failures. Logged via slog only; not queryable
   via the audit endpoints.

#182 frames the unification: every audit-worthy event flows through
a single table that the admin's audit handlers (detail / stream /
export / typeahead) already understand.

The shape question is whether to keep the **generic before/after
diff** the existing `audit_log` uses or move to a **per-action
structured schema** where each event type declares its own
payload struct.

## Decision

**Per-action structured schema** stored in a new `payload` JSONB
column with a sibling `payload_schema` discriminator. The existing
`diff` column stays for backward compatibility but new emitters
populate `payload` instead.

Schema discriminator format: `<namespace>.<action>.v<n>` —
e.g., `config.route_upserted.v1`, `cert.lifecycle_event.v1`,
`raft.leader_change.v1`. The `v<n>` lets us version individual
payloads without table-wide migrations.

The Go side defines a typed struct per discriminator. Marshalling
to / from `payload` is centralised so consumers don't reach into
the raw JSON. A registry maps each discriminator to a constructor
+ unmarshaller, so the audit-renderer in the admin panel can dispatch
on the discriminator to get a typed view.

## Why not generic before/after diff

- **Diff doesn't model lifecycle events.** A certificate-renewal
  audit entry isn't an entity update — there's no "before". A
  leader change isn't either. Forcing them into the diff shape
  produces awkward synthetic before-states that confuse readers.
- **Diff is opaque to indexing.** Querying "show me all
  authentication-policy changes in the last 7 days" requires
  scanning every row with `entity_type='auth_policy'`. With a
  typed payload, the admin renderer can extract specific fields
  (e.g. the changed permission set) and we can index high-value
  fields per schema as the audit volume grows.
- **Field-level redaction is hard with diff.** Some admin actions
  reveal data we'd rather not store verbatim (e.g. PKI cert SANs,
  tenant slug renames). Per-action schemas declare which fields
  are PII and the redaction layer (#74) honours them at write
  time.

## Why not per-action *table*

- **Cross-cutting queries explode.** The admin's "all audit events
  for actor X" needs UNION ALL across N tables. With a single
  table + discriminator, it's a single index scan.
- **Retention policy stays simple.** One pruning loop, one config
  knob (`audit_retention_config`). Multiple tables would need
  per-table retention.
- **Stream + export + typeahead handlers already exist** for the
  unified table. Keeping them working unchanged is the explicit
  goal of #182 ("the existing chunk-6 handlers keep working at
  the API boundary").

## Why backward-compatible (keep `diff`)

- Existing rows in `audit_log` are not migrated. They keep their
  `diff` blob and surface as-is.
- Existing emitters keep working unchanged until each is
  individually ported to the new payload shape. The `payload`
  column is nullable; the `payload_schema` column is nullable.
- The admin renderer dispatches on discriminator: when
  `payload_schema` is non-null, render via the typed path;
  otherwise fall back to the diff renderer.
- Migrating each existing emitter is a per-module task (config,
  PKI, RBAC, …) tracked under #182's children.

## Consequences

- **Migration 39:** add `payload_schema TEXT NULL` +
  `payload TEXT NULL` (JSON-encoded) to `audit_log`. Per-dialect.
  Index `payload_schema` since the renderer dispatches on it.
- **Discriminator registry** in `internal/store/audit/registry.go`:
  each registered schema has a Go struct, a marshaller, and an
  optional redactor that runs at insert time.
- **Insert API expansion:** the existing `tx.AppendAuditLog(...)`
  gains a new sibling `tx.AppendAuditEvent(payload AuditPayload)`
  that derives `entity_type / entity_id / operation` from the
  payload's discriminator + struct fields. Old call sites can
  keep using the legacy method during the migration.
- **Read path:** `GetAuditEntry` returns a struct with both
  `Diff` (legacy, possibly empty) and `Payload + PayloadSchema`
  (new, possibly null). Stream + export + typeahead operate on
  the wider tuple.
- **Pruning** hooks the existing `audit_retention_config`
  surface. Per-discriminator overrides are explicitly out of
  scope for v1; one global retention applies. Per-class
  overrides are a v2 candidate if a customer materially needs
  to keep cert lifecycle longer than admin actions.
- **Raft + cert lifecycle migration** is two follow-up issues:
  one each to convert their existing slog calls into
  structured `AppendAuditEvent` calls under
  `raft.*.v1` and `cert.*.v1` discriminators.
