/**
 * Routes adapter — bridges the daemon's proto V1Route shape to the
 * admin panel's simplified Route resource type and vice-versa.
 *
 * ## V1Route structure
 * The proto `V1Route` models the route as: matchers (paths, methods, headers),
 * a direct upstream override (optional), labels, policyIds, and serviceId.
 *
 * ## Admin Route structure
 * The admin `Route` uses a simplified single path + single method model with
 * explicit `match_kind`, `strip_prefix`, `rewrite_path`, `headers_add`,
 * `headers_remove`, `middleware_ids`, `policies` (=policyIds), and `enabled`.
 *
 * ## Convention for admin metadata in labels
 * Fields with no direct proto equivalent are stored in `labels.labels`:
 *   - `rioku.admin/match-kind`      → "prefix"|"exact"|"regex"
 *   - `rioku.admin/strip-prefix`    → "true"|"false"
 *   - `rioku.admin/rewrite-path`    → rewrite path string
 *   - `rioku.admin/headers-add`     → JSON-encoded Record<string,string>
 *   - `rioku.admin/headers-remove`  → comma-separated list
 *   - `rioku.admin/middleware-ids`  → comma-separated ordered list of middleware IDs
 *
 * middleware_ids is in labels pending Decision 003 (middleware-order endpoint).
 */

import type { V1Route } from '@/api/generated/schemas';
import { V1PathMatcherType } from '@/api/generated/schemas';
import type { Route } from '@/api/resources';
import type { RouteInput } from './types';

// ─── Label keys ───────────────────────────────────────────────────────────────

export const LBL_MATCH_KIND = 'rioku.admin/match-kind';
export const LBL_STRIP_PREFIX = 'rioku.admin/strip-prefix';
export const LBL_REWRITE_PATH = 'rioku.admin/rewrite-path';
export const LBL_HEADERS_ADD = 'rioku.admin/headers-add';
export const LBL_HEADERS_REMOVE = 'rioku.admin/headers-remove';
export const LBL_MIDDLEWARE_IDS = 'rioku.admin/middleware-ids';

// ─── V1Route → Route ──────────────────────────────────────────────────────────

/** Derive the admin match_kind from the first path matcher's type. */
function deriveMatchKind(proto: V1Route): Route['match_kind'] {
  const pathType = proto.matchers?.[0]?.paths?.[0]?.type;
  switch (pathType) {
    case V1PathMatcherType.TYPE_EXACT:
      return 'exact';
    case V1PathMatcherType.TYPE_REGEXP:
      return 'regex';
    case V1PathMatcherType.TYPE_PREFIX:
    default:
      return 'prefix';
  }
}

/** Derive the admin method from the first matcher's methods list. */
function deriveMethod(proto: V1Route): Route['method'] {
  const method = proto.matchers?.[0]?.methods?.[0];
  const valid: Route['method'][] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'ANY'];
  if (method && (valid as string[]).includes(method)) {
    return method as Route['method'];
  }
  return 'ANY';
}

/** Map a proto V1Route to the admin Route resource type. */
export function fromProtoRoute(proto: V1Route, tenantId: string): Route {
  const labels = proto.labels?.labels ?? {};

  const path = proto.matchers?.[0]?.paths?.[0]?.value ?? '';
  const method = deriveMethod(proto);
  const matchKind = deriveMatchKind(proto);
  const stripPrefix = labels[LBL_STRIP_PREFIX] === 'true';
  const rewritePath = labels[LBL_REWRITE_PATH] ?? undefined;
  const headersAdd: Record<string, string> = (() => {
    try {
      return labels[LBL_HEADERS_ADD] ? (JSON.parse(labels[LBL_HEADERS_ADD]) as Record<string, string>) : {};
    } catch {
      return {};
    }
  })();
  const headersRemove = labels[LBL_HEADERS_REMOVE]
    ? labels[LBL_HEADERS_REMOVE].split(',').filter(Boolean)
    : [];
  const middlewareIds = labels[LBL_MIDDLEWARE_IDS]
    ? labels[LBL_MIDDLEWARE_IDS].split(',').filter(Boolean)
    : [];

  return {
    id: proto.id ?? '',
    service_id: proto.serviceId ?? '',
    name: proto.name ?? '',
    path,
    method,
    match_kind: matchKind,
    strip_prefix: stripPrefix,
    ...(rewritePath !== undefined ? { rewrite_path: rewritePath } : {}),
    headers_add: headersAdd,
    headers_remove: headersRemove,
    policies: proto.policyIds ?? [],
    middleware_ids: middlewareIds,
    enabled: proto.enabled ?? true,
    created_at: proto.createdAt ?? '',
    updated_at: proto.updatedAt ?? '',
    // Note: tenant_id not in V1Route — passed from caller context
     
    ...(tenantId ? { tenant_id: tenantId } : {}),
  };
}

// ─── RouteInput → V1Route ─────────────────────────────────────────────────────

/** Map a match_kind + path to a V1PathMatcherType. */
function toProtoPathMatcherType(matchKind: Route['match_kind']): string {
  switch (matchKind) {
    case 'exact':
      return V1PathMatcherType.TYPE_EXACT;
    case 'regex':
      return V1PathMatcherType.TYPE_REGEXP;
    case 'prefix':
    default:
      return V1PathMatcherType.TYPE_PREFIX;
  }
}

/** Build a proto V1Route body from the admin RouteInput form values. */
export function toProtoRouteBody(input: RouteInput): V1Route {
  const labels: Record<string, string> = {};
  labels[LBL_MATCH_KIND] = input.match_kind;
  if (input.strip_prefix) labels[LBL_STRIP_PREFIX] = 'true';
  if (input.rewrite_path) labels[LBL_REWRITE_PATH] = input.rewrite_path;
  if (input.headers_add && Object.keys(input.headers_add).length > 0) {
    labels[LBL_HEADERS_ADD] = JSON.stringify(input.headers_add);
  }
  if (input.headers_remove && input.headers_remove.length > 0) {
    labels[LBL_HEADERS_REMOVE] = input.headers_remove.join(',');
  }
  if (input.middleware_ids && input.middleware_ids.length > 0) {
    labels[LBL_MIDDLEWARE_IDS] = input.middleware_ids.join(',');
  }

  const methods = input.method === 'ANY' ? [] : [input.method];

  return {
    name: input.name,
    serviceId: input.service_id,
    enabled: input.enabled ?? true,
    policyIds: input.policies ?? [],
    labels: { labels },
    matchers: [
      {
        methods,
        paths: [
          {
            value: input.path,
            type: toProtoPathMatcherType(input.match_kind) as V1PathMatcherType,
          },
        ],
      },
    ],
  };
}

/** Build a partial V1Route patch body from a RouteUpdateInput. */
export function toProtoRoutePatch(input: Partial<RouteInput>): V1Route {
  const patch: V1Route = {};

  if (input.name !== undefined) patch.name = input.name;
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (input.policies !== undefined) patch.policyIds = input.policies;
  if (input.service_id !== undefined) patch.serviceId = input.service_id;

  // Rebuild matchers if path/method/match_kind changed
  if (input.path !== undefined || input.method !== undefined || input.match_kind !== undefined) {
    patch.matchers = [
      {
        ...(input.method !== undefined ? { methods: input.method === 'ANY' ? [] : [input.method] } : {}),
        ...(input.path !== undefined
          ? {
              paths: [
                {
                  value: input.path,
                  type: toProtoPathMatcherType(input.match_kind ?? 'prefix') as V1PathMatcherType,
                },
              ],
            }
          : {}),
      },
    ];
  }

  // Rebuild labels for admin metadata
  const labelsToSet: Record<string, string> = {};
  if (input.match_kind !== undefined) labelsToSet[LBL_MATCH_KIND] = input.match_kind;
  if (input.strip_prefix !== undefined) labelsToSet[LBL_STRIP_PREFIX] = input.strip_prefix ? 'true' : 'false';
  if (input.rewrite_path !== undefined) labelsToSet[LBL_REWRITE_PATH] = input.rewrite_path;
  if (input.headers_add !== undefined) labelsToSet[LBL_HEADERS_ADD] = JSON.stringify(input.headers_add);
  if (input.headers_remove !== undefined) labelsToSet[LBL_HEADERS_REMOVE] = input.headers_remove.join(',');
  if (input.middleware_ids !== undefined) labelsToSet[LBL_MIDDLEWARE_IDS] = input.middleware_ids.join(',');

  if (Object.keys(labelsToSet).length > 0) {
    patch.labels = { labels: labelsToSet };
  }

  return patch;
}
