/**
 * Services adapter — bridges the daemon's proto V1Service shape to the
 * admin panel's simplified Service resource type and vice-versa.
 *
 * ## Rationale (Decision 001)
 * The proto `V1Service` is a Caddy-native config object (upstreams[], lb_policy,
 * healthCheck, …). The admin panel's `Service` type is a simplified management
 * view (upstream string, env, health status, tags). An adapter layer bridges
 * both directions without requiring components to know about the proto shape.
 *
 * ## Convention for admin metadata in labels
 * Admin-only fields that have no proto equivalent are stored in the `labels`
 * map under the `rioku.admin/` prefix:
 *   - `rioku.admin/env`           → service env (e.g. "production")
 *   - `rioku.admin/tags`          → comma-separated tag list (e.g. "a,b,c")
 *   - `rioku.admin/protocol`      → upstream protocol hint ("http"|"https"|"grpc")
 *   - `rioku.admin/description`   → optional human description
 *
 * Health status is computed from the first upstream's `healthy` field; a
 * missing upstream defaults to "unhealthy". "disabled" is stored as
 * `rioku.admin/disabled: "true"` in labels.
 *
 * This is an interim convention pending Decision 001 resolution.
 */

import type { V1Service, V1Upstream } from '@/api/generated/schemas';
import type { Service } from '@/api/resources';
import type { ServiceInput } from './types';

// ─── Label keys ───────────────────────────────────────────────────────────────

export const LBL_ENV = 'rioku.admin/env';
export const LBL_TAGS = 'rioku.admin/tags';
export const LBL_PROTOCOL = 'rioku.admin/protocol';
export const LBL_DESCRIPTION = 'rioku.admin/description';
export const LBL_DISABLED = 'rioku.admin/disabled';

// ─── V1Service → Service ──────────────────────────────────────────────────────

/**
 * Derive health status from the proto upstream list + disabled label.
 * - If the disabled label is "true" → "disabled"
 * - If all upstreams are healthy → "healthy"
 * - If some upstreams are unhealthy → "degraded"
 * - If all upstreams are unhealthy (or none) → "unhealthy"
 */
function deriveHealth(
  upstreams: V1Upstream[] | undefined,
  labels: Record<string, string>,
): Service['health'] {
  if (labels[LBL_DISABLED] === 'true') return 'disabled';
  if (!upstreams || upstreams.length === 0) return 'unhealthy';

  const total = upstreams.length;
  const healthyCount = upstreams.filter((u) => u.healthy === true).length;

  if (healthyCount === total) return 'healthy';
  if (healthyCount === 0) return 'unhealthy';
  return 'degraded';
}

/** Map a proto V1Service to the admin Service resource type. */
export function fromProtoService(proto: V1Service, tenantId: string): Service {
  const labels = proto.labels?.labels ?? {};
  const upstream = proto.upstreams?.[0]?.address ?? '';
  const upstreamProtocol = (labels[LBL_PROTOCOL] as Service['upstream_protocol']) ?? 'http';
  const env = labels[LBL_ENV] ?? '';
  const tags = labels[LBL_TAGS] ? labels[LBL_TAGS].split(',').filter(Boolean) : [];
  const description = labels[LBL_DESCRIPTION] || undefined;
  const health = deriveHealth(proto.upstreams, labels);

  // health_check: map from proto HealthCheck if present
  const hc = proto.healthCheck;
  const health_check =
    hc && hc.path
      ? {
          path: hc.path,
          interval_seconds: hc.intervalSeconds ?? 30,
          timeout_seconds: hc.timeoutSeconds ?? 5,
        }
      : undefined;

  return {
    id: proto.id ?? '',
    tenant_id: tenantId,
    name: proto.name ?? '',
    upstream,
    upstream_protocol: upstreamProtocol,
    env,
    health,
    tags,
    ...(description !== undefined ? { description } : {}),
    ...(health_check !== undefined ? { health_check } : {}),
    created_at: proto.createdAt ?? '',
    ...(proto.updatedAt ? { last_reloaded_at: undefined } : {}),
  };
}

// ─── ServiceInput → V1Service ─────────────────────────────────────────────────

/** Build a proto V1Service body from the admin ServiceInput form values. */
export function toProtoServiceBody(input: ServiceInput): V1Service {
  const labels: Record<string, string> = {};
  if (input.env) labels[LBL_ENV] = input.env;
  if (input.tags && input.tags.length > 0) labels[LBL_TAGS] = input.tags.join(',');
  if (input.upstream_protocol) labels[LBL_PROTOCOL] = input.upstream_protocol;
  if (input.description) labels[LBL_DESCRIPTION] = input.description;

  const upstream: V1Upstream = { address: input.upstream };

  const body: V1Service = {
    name: input.name,
    upstreams: [upstream],
    labels: { labels },
  };

  if (input.health_check) {
    body.healthCheck = {
      path: input.health_check.path,
      intervalSeconds: input.health_check.interval_seconds,
      timeoutSeconds: input.health_check.timeout_seconds,
    };
  }

  return body;
}

/** Build a partial V1Service patch body from a ServiceUpdateInput. */
export function toProtoServicePatch(
  input: Partial<ServiceInput & { health?: Service['health'] }>,
): V1Service {
  const patch: V1Service = {};

  if (input.name !== undefined) patch.name = input.name;

  // Rebuild upstream if address changed
  if (input.upstream !== undefined) {
    patch.upstreams = [{ address: input.upstream }];
  }

  // Rebuild labels for admin metadata fields
  const labelsToSet: Record<string, string> = {};
  if (input.env !== undefined) labelsToSet[LBL_ENV] = input.env;
  if (input.tags !== undefined) labelsToSet[LBL_TAGS] = input.tags.join(',');
  if (input.upstream_protocol !== undefined) labelsToSet[LBL_PROTOCOL] = input.upstream_protocol;
  if (input.description !== undefined) labelsToSet[LBL_DESCRIPTION] = input.description;
  // health toggle via disabled label
  if (input.health === 'disabled') labelsToSet[LBL_DISABLED] = 'true';
  else if (input.health !== undefined) labelsToSet[LBL_DISABLED] = 'false';

  if (Object.keys(labelsToSet).length > 0) {
    patch.labels = { labels: labelsToSet };
  }

  if (input.health_check !== undefined) {
    patch.healthCheck = {
      path: input.health_check.path,
      intervalSeconds: input.health_check.interval_seconds,
      timeoutSeconds: input.health_check.timeout_seconds,
    };
  }

  return patch;
}
