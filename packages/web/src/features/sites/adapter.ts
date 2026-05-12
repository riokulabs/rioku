/**
 * Sites adapter — bridges the daemon's wire shape (`Site` from generated
 * schemas) to the admin panel's `Site` resource type and back.
 *
 * Note: the daemon does not (yet) persist `tls_manual_cert` previews or
 * `redirect_rules` as a structured array; the admin panel preserves these
 * fields as opt-in best-effort extras.
 */

import type { Site as ProtoSite } from '@/api/generated/schemas';
import type { Site } from '@/api/resources';
import type { SiteUpdateInput, SiteWizardInput } from './types';

const TLS_MODES: Site['tls_mode'][] = ['auto', 'manual', 'off'];
const RATE_PRESETS: Site['rate_limit_preset'][] = ['none', 'lenient', 'standard', 'strict'];

function asTLSMode(s: string | undefined): Site['tls_mode'] {
  return TLS_MODES.includes(s as Site['tls_mode']) ? (s as Site['tls_mode']) : 'auto';
}

function asRatePreset(s: string | undefined): Site['rate_limit_preset'] {
  return RATE_PRESETS.includes(s as Site['rate_limit_preset'])
    ? (s as Site['rate_limit_preset'])
    : 'none';
}

/** Wire → admin resource. */
export function fromProtoSite(proto: ProtoSite, fallbackTenantId: string): Site {
  return {
    id: proto.id ?? '',
    tenant_id: proto.tenantId ?? fallbackTenantId,
    name: proto.name ?? '',
    domain: proto.domain ?? '',
    tls_mode: asTLSMode(proto.tlsMode),
    enabled: proto.enabled ?? true,
    ...(proto.upstreamServiceId !== undefined
      ? { upstream_service_id: proto.upstreamServiceId }
      : {}),
    basic_auth_enabled: proto.basicAuthEnabled ?? false,
    rate_limit_preset: asRatePreset(proto.rateLimitPreset),
    redirect_rules: [],
    created_at: proto.createdAt ?? new Date().toISOString(),
    updated_at: proto.updatedAt ?? new Date().toISOString(),
  };
}

/** Wizard input → wire create body. The wizard's `new_upstream` mode is
 *  resolved upstream — this adapter only writes the site itself. */
export function toProtoSiteCreate(
  input: SiteWizardInput,
  upstreamServiceId?: string,
): {
  name: string;
  domain: string;
  tlsMode: string;
  upstreamServiceId?: string;
  basicAuthEnabled?: boolean;
  rateLimitPreset?: string;
} {
  return {
    name: input.name,
    domain: input.domain,
    tlsMode: input.tls_mode,
    ...(upstreamServiceId !== undefined ? { upstreamServiceId } : {}),
    basicAuthEnabled: input.basic_auth_enabled ?? false,
    rateLimitPreset: input.rate_limit_preset ?? 'none',
  };
}

/** Admin patch → wire patch body. */
export function toProtoSitePatch(input: SiteUpdateInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (input.name !== undefined) body.name = input.name;
  if (input.domain !== undefined) body.domain = input.domain;
  if (input.tls_mode !== undefined) body.tlsMode = input.tls_mode;
  if (input.upstream_service_id !== undefined) body.upstreamServiceId = input.upstream_service_id;
  if (input.basic_auth_enabled !== undefined) body.basicAuthEnabled = input.basic_auth_enabled;
  if (input.rate_limit_preset !== undefined) body.rateLimitPreset = input.rate_limit_preset;
  return body;
}
