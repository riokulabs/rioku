/**
 * Danger zone settings — /t/$tenant/settings/danger.
 *
 * Hard reset tenant (triple-confirm with tenant slug typed three times),
 * export tenant JSON (downloaded), and delete tenant (super-admin only,
 * triple-confirm). Each action emits a high-tier audit row + admin audit
 * chain entry.
 *
 * Endpoints (stage-2 daemon):
 *   POST   /api/v1/t/:tenant/settings/danger/hard-reset  (body: { confirmation })
 *   GET    /api/v1/t/:tenant/settings/danger/export       (downloads JSON blob)
 *   DELETE /api/v1/t/:tenant/settings/danger/tenant        (super-admin only)
 *
 * Wraps the <DangerZoneSection> component built in stage-1 plan 8c.
 *
 * Guard: tenant:hard-reset (readers without this permission cannot reach the
 * page; the delete tenant action additionally requires tenant:delete, which
 * the section component enforces and hides the section for non-super-admins).
 *
 * Plan 7 — Task 9
 */
import { createFileRoute, Link, useParams } from '@tanstack/react-router';
import { Anchor, Group, Stack } from '@mantine/core';
import { IconArrowLeft } from '@tabler/icons-react';
import { useMockStore } from '@/api/mock-store';
import { requirePermissions } from '@/hooks/use-before-load';
import { DangerZoneSection } from '@/features/settings/sections/danger-zone';

function DangerSettingsPage() {
  const { tenant } = useParams({ strict: false });
  const tenantSlug = useMockStore((s) => s.tenants[s.currentTenantId ?? '']?.slug ?? tenant);

  return (
    <Stack gap="md" p="md" data-testid="settings-danger-page">
      <Group gap="xs">
        <Anchor
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
          component={Link as any}
          to="/t/$tenant/settings"
          params={{ tenant: tenantSlug }}
          size="sm"
          data-testid="settings-danger-back"
        >
          <Group gap={4} align="center">
            <IconArrowLeft size={14} />
            <span>Back to settings</span>
          </Group>
        </Anchor>
      </Group>
      <DangerZoneSection />
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/settings/danger')({
  beforeLoad: requirePermissions({ required: ['tenant:hard-reset'] }),
  component: DangerSettingsPage,
});
