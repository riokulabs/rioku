/**
 * Tenant general settings — /t/$tenant/settings/tenant.
 *
 * Tenant name, default theme, and logo upload. URL mode is excluded
 * (owned by Plan 12). Wraps the <TenantSection> component built in
 * stage-1 plan 8a.
 *
 * Guard: tenant:write (write access; readers see disabled form inside
 * the section component).
 *
 * Plan 7 — Task 2
 */
import { createFileRoute, Link, useParams } from '@tanstack/react-router';
import { Anchor, Group, Stack } from '@mantine/core';
import { IconArrowLeft } from '@tabler/icons-react';
import { useMockStore } from '@/api/mock-store';
import { requirePermissions } from '@/hooks/use-before-load';
import { TenantSection } from '@/features/settings/sections/tenant';

function TenantSettingsPage() {
  const { tenant } = useParams({ strict: false });
  const tenantSlug = useMockStore((s) => s.tenants[s.currentTenantId ?? '']?.slug ?? tenant);

  return (
    <Stack gap="md" p="md" data-testid="settings-tenant-page">
      <Group gap="xs">
        <Anchor
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
          component={Link as any}
          to="/t/$tenant/settings"
          params={{ tenant: tenantSlug }}
          size="sm"
          data-testid="settings-tenant-back"
        >
          <Group gap={4} align="center">
            <IconArrowLeft size={14} />
            <span>Back to settings</span>
          </Group>
        </Anchor>
      </Group>
      <TenantSection />
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/settings/tenant')({
  beforeLoad: requirePermissions({ required: ['tenant:read'] }),
  component: TenantSettingsPage,
});
