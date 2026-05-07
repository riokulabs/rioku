/**
 * Full-page user detail route — /t/$tenant/security/users/$userId
 *
 * Stage-2 plan-02. Renders <UserFullPage> with Profile / Effective
 * Permissions / Sessions / Audit tabs against the real daemon endpoints.
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Stack, Group, Button } from '@mantine/core';
import { IconArrowLeft } from '@tabler/icons-react';
import { requirePermissions } from '@/hooks/use-before-load';
import { UserFullPage } from '@/features/security/users';

function UserFullPageRoute() {
  const { tenant, userId } = Route.useParams();
  const navigate = useNavigate();

  const tenantId = tenant ?? '';
  const tenantSlug = tenant ?? '';

  return (
    <Stack gap="md" p="md">
      <Group>
        <Button
          variant="subtle"
          size="xs"
          leftSection={<IconArrowLeft size={14} />}
          onClick={() => {
            void navigate({
              to: '/t/$tenant/security/users',
              params: { tenant: tenantSlug },
            } as unknown as Parameters<typeof navigate>[0]);
          }}
        >
          Back to users
        </Button>
      </Group>

      <UserFullPage userId={userId} tenantId={tenantId} tenantSlug={tenantSlug} />
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/security/users/$userId')({
  beforeLoad: requirePermissions({ required: ['user:read'] }),
  component: UserFullPageRoute,
});
