/**
 * Audit retention settings — /t/$tenant/settings/audit-retention.
 *
 * Standalone subpage (not a Settings-layout section) because the
 * retention form owns a non-trivial amount of state and the sectioned
 * SettingsLayout is a placeholder stack. A "Back to settings" anchor
 * keeps the page discoverable from the settings sidebar.
 *
 * Read is gated by audit:retention:read (beforeLoad). Write is gated by
 * audit:retention:write inside the form component — readers see the
 * fields populated but disabled.
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { Anchor, Group, Stack, Text, Title } from '@mantine/core';
import { IconArrowLeft } from '@tabler/icons-react';
import { useMockStore } from '@/api/mock-store';
import { requirePermissions } from '@/hooks/use-before-load';
import { RetentionConfigForm } from '@/features/audit/components/retention-config-form';

function AuditRetentionSettingsPage() {
  const { tenant } = Route.useParams();
  const tenantRecord = useMockStore((s) =>
    Object.values(s.tenants).find((t) => t.slug === tenant),
  );
  const tenantId = tenantRecord?.id ?? '';
  const tenantSlug = tenantRecord?.slug ?? tenant;

  return (
    <Stack gap="md" p="md" data-testid="audit-retention-page">
      <Group gap="xs">
        <Anchor
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment -- TanStack Link + Mantine polymorphic props require a cast
          component={Link as any}
          to="/t/$tenant/settings"
          params={{ tenant: tenantSlug }}
          size="sm"
          data-testid="audit-retention-back"
        >
          <Group gap={4} align="center">
            <IconArrowLeft size={14} />
            <span>Back to settings</span>
          </Group>
        </Anchor>
      </Group>

      <Stack gap={4}>
        <Title order={2}>Audit retention</Title>
        <Text size="sm">
          Control how long audit entries are retained per tier and whether
          they are auto-exported to long-term storage before deletion.
        </Text>
      </Stack>

      <RetentionConfigForm tenantId={tenantId} />
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/settings/audit-retention')({
  beforeLoad: requirePermissions({ required: ['audit:retention:read'] }),
  component: AuditRetentionSettingsPage,
});
