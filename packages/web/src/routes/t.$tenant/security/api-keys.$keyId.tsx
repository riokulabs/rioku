/**
 * Full-page API key detail route — /t/$tenant/security/api-keys/$keyId
 *
 * Stage-2 plan-02. Renders <ApiKeyFullPage> with Profile / Usage /
 * Audit tabs against the real daemon endpoints.
 */
import { createFileRoute, Link, useParams } from '@tanstack/react-router';
import { Stack, Group, Button } from '@mantine/core';
import { IconArrowLeft } from '@tabler/icons-react';
import { useMockStore } from '@/api/mock-store';
import { requirePermissions } from '@/hooks/use-before-load';
import { ApiKeyFullPage } from '@/features/security/api-keys';

function ApiKeyFullPageRoute() {
  const { tenant, keyId } = useParams({
    from: '/t/$tenant/security/api-keys/$keyId',
  });

  const tenantRecord = useMockStore((s) => Object.values(s.tenants).find((t) => t.slug === tenant));
  const tenantId = tenantRecord?.id ?? '';
  const tenantSlug = tenantRecord?.slug ?? tenant;

  return (
    <Stack gap="md" p="md">
      <Group>
        <Button
          /* eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment */
          component={Link as any}
          to="/t/$tenant/security/api-keys"
          params={{ tenant: tenantSlug }}
          variant="subtle"
          size="xs"
          leftSection={<IconArrowLeft size={14} />}
        >
          Back to API keys
        </Button>
      </Group>

      <ApiKeyFullPage tenantId={tenantId} tenantSlug={tenantSlug} keyId={keyId} />
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/security/api-keys/$keyId')({
  beforeLoad: requirePermissions({ required: ['api-key:read'] }),
  component: ApiKeyFullPageRoute,
});
