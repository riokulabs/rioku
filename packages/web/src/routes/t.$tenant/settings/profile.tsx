/**
 * Profile settings — /t/$tenant/settings/profile.
 *
 * Standalone sub-page for the current user's profile: name, avatar, password,
 * TOTP backup codes, and preferences. Wraps the <ProfileSection> component
 * that was fully built in stage-1 plan 8a.
 *
 * Guard: user:update-own is enforced inside the section; the route itself
 * only requires tenant:switch (all authenticated members may view their
 * own profile settings).
 *
 * Plan 7 — Task 1
 */
import { createFileRoute, Link, useParams } from '@tanstack/react-router';
import { Anchor, Group, Stack } from '@mantine/core';
import { IconArrowLeft } from '@tabler/icons-react';
import { requirePermissions } from '@/hooks/use-before-load';
import { ProfileRealSection } from '@/features/settings/sections-real/profile-real';

function ProfileSettingsPage() {
  const { tenant } = useParams({ strict: false });
  const tenantSlug = tenant ?? '';
  const activeTenant: string = tenantSlug;

  return (
    <Stack gap="md" p="md" data-testid="settings-profile-page">
      <Group gap="xs">
        <Anchor
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
          component={Link as any}
          to="/t/$tenant/settings"
          params={{ tenant: tenantSlug }}
          size="sm"
          data-testid="settings-profile-back"
        >
          <Group gap={4} align="center">
            <IconArrowLeft size={14} />
            <span>Back to settings</span>
          </Group>
        </Anchor>
      </Group>
      <ProfileRealSection tenant={activeTenant} />
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/settings/profile')({
  beforeLoad: requirePermissions({ required: ['tenant:switch'] }),
  component: ProfileSettingsPage,
});
