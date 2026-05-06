/**
 * Auth policy settings — /t/$tenant/settings/auth-policy.
 *
 * Tenant-scoped authentication policy: TOTP enforcement, password rules,
 * and session timeouts. PUT to /api/v1/t/:tenant/settings/auth-policy.
 * Wraps the <AuthenticationSection> component built in stage-1 plan 8a.
 *
 * Guard: tenant-auth:read (readers see disabled form; writers can mutate).
 *
 * Plan 7 — Task 3
 */
import { createFileRoute, Link, useParams } from '@tanstack/react-router';
import { Anchor, Group, Stack } from '@mantine/core';
import { IconArrowLeft } from '@tabler/icons-react';
import { useMockStore } from '@/api/mock-store';
import { requirePermissions } from '@/hooks/use-before-load';
import { AuthenticationSection } from '@/features/settings/sections/authentication';

function AuthPolicySettingsPage() {
  const { tenant } = useParams({ strict: false });
  const tenantSlug = useMockStore((s) => s.tenants[s.currentTenantId ?? '']?.slug ?? tenant);

  return (
    <Stack gap="md" p="md" data-testid="settings-auth-policy-page">
      <Group gap="xs">
        <Anchor
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
          component={Link as any}
          to="/t/$tenant/settings"
          params={{ tenant: tenantSlug }}
          size="sm"
          data-testid="settings-auth-policy-back"
        >
          <Group gap={4} align="center">
            <IconArrowLeft size={14} />
            <span>Back to settings</span>
          </Group>
        </Anchor>
      </Group>
      <AuthenticationSection />
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/settings/auth-policy')({
  beforeLoad: requirePermissions({ required: ['tenant-auth:read'] }),
  component: AuthPolicySettingsPage,
});
