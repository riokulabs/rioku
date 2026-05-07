/**
 * Smoke tests for the Orval-generated settings hooks
 * (`src/api/generated/settings/settings.ts`).
 *
 * Closes decisions-needed item 07-001 by exercising the URL builders that
 * Orval generates from `packages/proto/openapi-fragments/settings.yaml` —
 * one assertion per sub-area to lock the spec ↔ daemon contract:
 *
 *  - profile / tenant / auth-policy
 *  - network / observability triplet
 *  - tls / pki / integrations + webhook test
 *  - danger trio (hard-reset, export, delete tenant)
 *
 * The deeper field-shape contract is exercised by:
 *   - daemon Go contract tests (`packages/daemon/internal/gateway/contract_test.go`),
 *   - the existing hand-rolled tests in `real-api.test.ts`.
 *
 * These hooks remain the canonical client for stage-2 once the deep
 * sections (profile.tsx, tenant.tsx, …) are re-wired in Plan 13.
 */
import { describe, expect, it } from 'vitest';
import {
  getGetSettingsProfileUrl,
  getGetSettingsTenantUrl,
  getGetSettingsAuthPolicyUrl,
  getGetSettingsNetworkUrl,
  getGetSettingsObservabilityMetricsUrl,
  getGetSettingsObservabilityLogsUrl,
  getGetSettingsObservabilityTracesUrl,
  getGetSettingsTLSUrl,
  getGetSettingsPKIUrl,
  getGetSettingsIntegrationsUrl,
  getPostWebhookTestUrl,
  getPostDangerHardResetUrl,
  getGetDangerExportUrl,
  getDeleteDangerTenantUrl,
} from '@/api/generated/settings/settings';

describe('generated settings URL builders (Orval, plan-07 fragment)', () => {
  it('emits the canonical settings sub-route paths', () => {
    const t = 'acme';

    expect(getGetSettingsProfileUrl(t)).toBe(`/api/v1/t/${t}/settings/me`);
    expect(getGetSettingsTenantUrl(t)).toBe(`/api/v1/t/${t}/settings/tenant`);
    expect(getGetSettingsAuthPolicyUrl(t)).toBe(`/api/v1/t/${t}/settings/auth-policy`);
    expect(getGetSettingsNetworkUrl(t)).toBe(`/api/v1/t/${t}/settings/network`);

    expect(getGetSettingsObservabilityMetricsUrl(t)).toBe(
      `/api/v1/t/${t}/settings/observability/metrics`,
    );
    expect(getGetSettingsObservabilityLogsUrl(t)).toBe(
      `/api/v1/t/${t}/settings/observability/logs`,
    );
    expect(getGetSettingsObservabilityTracesUrl(t)).toBe(
      `/api/v1/t/${t}/settings/observability/traces`,
    );

    expect(getGetSettingsTLSUrl(t)).toBe(`/api/v1/t/${t}/settings/tls`);
    expect(getGetSettingsPKIUrl(t)).toBe(`/api/v1/t/${t}/settings/pki`);
    expect(getGetSettingsIntegrationsUrl(t)).toBe(`/api/v1/t/${t}/settings/integrations`);

    expect(getPostWebhookTestUrl(t, 'wh-42')).toBe(
      `/api/v1/t/${t}/settings/webhooks/wh-42/test`,
    );

    expect(getPostDangerHardResetUrl(t)).toBe(`/api/v1/t/${t}/settings/danger/hard-reset`);
    expect(getGetDangerExportUrl(t)).toBe(`/api/v1/t/${t}/settings/danger/export`);
    expect(getDeleteDangerTenantUrl(t)).toBe(`/api/v1/t/${t}/settings/danger/tenant`);
  });
});
