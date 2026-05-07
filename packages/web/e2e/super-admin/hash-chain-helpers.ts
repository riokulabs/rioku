/**
 * Hash-chain helpers for super-admin Playwright specs.
 *
 * Mirrors the SHA-256 entry hash used by `verifyAdminAuditChain` in
 * `src/api/resources/audit.ts`. The runtime verifier serialises the entry
 * (sans `hash`) with `JSON.stringify` and SHA-256s it; we do the same here so
 * the spec ships authentic chain data, not placeholder hashes.
 */
// Use the Web Crypto API (available on `globalThis` in Node 20+ and the
// browser) so this helper compiles without `@types/node` and matches the
// runtime audit hasher byte-for-byte.

export interface ChainedEntry {
  id: string;
  kind: 'admin';
  tenant_id: string | null;
  actor_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  outcome: 'success' | 'denied' | 'error';
  at: string;
  tier: 'read' | 'read-sensitive' | 'write' | 'destructive';
  prev_hash: string;
  hash: string;
}

export async function hashEntryForTest(
  partial: Omit<ChainedEntry, 'hash'>,
): Promise<string> {
  // Property insertion order MUST match the runtime audit logger's literal so
  // JSON.stringify yields byte-identical output. See logAdminAuditEntry in
  // src/api/resources/audit.ts.
  const ordered = orderForRuntime(partial);
  const serialised = JSON.stringify(ordered);
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialised));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function orderForRuntime(p: Omit<ChainedEntry, 'hash'>): Record<string, unknown> {
  // Match the property insertion order used by logAdminAuditEntry in
  // src/api/resources/audit.ts so the canonical JSON serialisation matches:
  //   id, kind, tenant_id, actor_id, action, resource_type, resource_id?,
  //   outcome, at, tier, prev_hash, ...optional payload fields.
  const out: Record<string, unknown> = {
    id: p.id,
    kind: p.kind,
    tenant_id: p.tenant_id,
    actor_id: p.actor_id,
    action: p.action,
    resource_type: p.resource_type,
  };
  if (p.resource_id) {
    out.resource_id = p.resource_id;
  }
  out.outcome = p.outcome;
  out.at = p.at;
  out.tier = p.tier;
  out.prev_hash = p.prev_hash;
  return out;
}
