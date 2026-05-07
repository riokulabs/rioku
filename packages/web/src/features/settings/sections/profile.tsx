/**
 * <ProfileSection> — settings profile section.
 *
 * Renders 4 subsections (stage 1):
 *   1. Personal info  — name (inline-edit), email (read-only), avatar uploader
 *   2. Password       — "Change password" button → modal
 *   3. TOTP           — enrollment status, re-enroll link, reset backup codes
 *   4. Preferences    — theme, locale, timezone, reduced motion, notifications
 *
 * Passkeys section is hidden until the `passkeys` feature flag is enabled (stage 2+).
 *
 * Rendered INLINE by <SettingsLayout> when activeSection.slug === 'profile'.
 * Always self-scope — uses `user:update-own` permission.
 *
 * Task 8a.2
 */
import { useState, useCallback } from 'react';
import {
  Alert,
  Badge,
  Button,
  Divider,
  Group,
  Loader,
  Stack,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconAlertCircle, IconShieldCheck, IconShieldOff } from '@tabler/icons-react';
import { Link } from '@tanstack/react-router';
import { notify } from '@/hooks/use-notify';
import { usePermission } from '@/hooks/use-permission';
import { isFeatureEnabled } from '@/host/feature-flags';
import { useActiveTenantSlug } from '@/hooks/use-tenant';
import { useCurrentUser, resetBackupCodes } from '../api';
import { ProfilePersonalInfo } from './profile-personal-info';
import { ProfilePasswordModal } from './profile-password-modal';
import { ProfilePasskeys } from './profile-passkeys';
import { ProfilePreferences } from './profile-preferences';

export function ProfileSection() {
  const user = useCurrentUser();
  const canUpdate = usePermission('user:update-own');
  const tenantSlug = useActiveTenantSlug() ?? '';

  const [passwordOpened, { open: openPassword, close: closePassword }] = useDisclosure(false);

  // ── Backup codes reset ────────────────────────────────────────────────────
  const [codesLoading, setCodesLoading] = useState(false);
  const [codesError, setCodesError] = useState<string | null>(null);

  const handleResetBackupCodes = useCallback(async () => {
    if (!user) return;
    setCodesLoading(true);
    setCodesError(null);
    try {
      const codes = await resetBackupCodes(user.id);
      notify.success(
        'Backup codes regenerated',
        `${String(codes.length)} new backup codes have been created. Store them securely.`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to reset backup codes';
      setCodesError(msg);
    } finally {
      setCodesLoading(false);
    }
  }, [user]);

  if (!user) {
    return (
      <Stack align="center" py="xl" data-testid="profile-loading">
        <Loader />
        <Text size="sm" c="var(--mantine-color-gray-7)">
          Loading profile…
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="xl" data-testid="profile-section">
      {/* ── 1. Personal info ───────────────────────────────────────────── */}
      <Stack gap="sm">
        <Title order={5} data-testid="profile-personal-info-heading">
          Personal information
        </Title>
        <ProfilePersonalInfo user={user} />
      </Stack>

      <Divider />

      {/* ── 2. Security (Password + TOTP grouped) ─────────────────────── */}
      <Stack gap="lg" data-testid="profile-security-section">
        <Title order={5}>Security</Title>

        {/* Password */}
        <Stack gap="xs" data-testid="profile-password-section">
          <Group gap="sm" justify="space-between" wrap="nowrap">
            <Stack gap={2}>
              <Text size="sm" fw={600}>
                Password
              </Text>
              <Text size="xs" c="var(--mantine-color-gray-7)">
                {user.force_password_change
                  ? 'You are required to change your password.'
                  : 'Update your account password.'}
              </Text>
            </Stack>
            <Tooltip
              label="You don't have permission to update your profile"
              disabled={canUpdate}
              withArrow
            >
              <span>
                <Button
                  variant="default"
                  size="sm"
                  onClick={openPassword}
                  disabled={!canUpdate}
                  data-testid="profile-change-password-btn"
                >
                  Change password
                </Button>
              </span>
            </Tooltip>
          </Group>
          {user.force_password_change && (
            <Alert icon={<IconAlertCircle size={14} />} color="yellow" variant="light" py="xs">
              A password change is required before your next login.
            </Alert>
          )}
          <ProfilePasswordModal userId={user.id} opened={passwordOpened} onClose={closePassword} />
        </Stack>

        {/* TOTP */}
        <Stack gap="xs" data-testid="profile-totp-section">
          <Group gap="sm" justify="space-between" wrap="nowrap" align="flex-start">
            <Stack gap={2}>
              <Group gap="xs">
                <Text size="sm" fw={600}>
                  Two-factor authentication (TOTP)
                </Text>
                {user.totp_enrolled ? (
                  <Badge
                    color="green"
                    variant="light"
                    size="xs"
                    leftSection={<IconShieldCheck size={10} />}
                    data-testid="profile-totp-status-enrolled"
                  >
                    Enrolled
                  </Badge>
                ) : (
                  <Badge
                    color="orange"
                    variant="light"
                    size="xs"
                    leftSection={<IconShieldOff size={10} />}
                    data-testid="profile-totp-status-not-enrolled"
                  >
                    Not enrolled
                  </Badge>
                )}
              </Group>
              <Text size="xs" c="var(--mantine-color-gray-7)">
                {user.totp_enrolled
                  ? 'TOTP is active on your account. Re-enroll to rotate your authenticator secret.'
                  : 'Enable TOTP to add a second factor to your login.'}
              </Text>
            </Stack>
            <Group gap="xs" wrap="nowrap">
              <Button
                // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
                component={Link as any}
                to="/t/$tenant/totp-enroll"
                params={{ tenant: tenantSlug }}
                variant="default"
                size="sm"
                data-testid="profile-totp-enroll-link"
              >
                {user.totp_enrolled ? 'Re-enroll' : 'Enroll'}
              </Button>
              {user.totp_enrolled && (
                <Tooltip
                  label="You don't have permission to update your profile"
                  disabled={canUpdate}
                  withArrow
                >
                  <span>
                    <Button
                      variant="default"
                      size="sm"
                      loading={codesLoading}
                      disabled={!canUpdate}
                      onClick={() => {
                        void handleResetBackupCodes();
                      }}
                      data-testid="profile-backup-codes-reset"
                    >
                      Reset backup codes
                    </Button>
                  </span>
                </Tooltip>
              )}
            </Group>
          </Group>
          {codesError && (
            <Text size="xs" c="red">
              {codesError}
            </Text>
          )}
        </Stack>

        {/* Passkeys */}
        {isFeatureEnabled('passkeys') && <ProfilePasskeys canUpdate={canUpdate} />}
      </Stack>

      <Divider />

      {/* ── 3. Preferences ─────────────────────────────────────────────── */}
      <Stack gap="sm" data-testid="profile-preferences-section">
        <Title order={5}>Preferences</Title>
        <ProfilePreferences user={user} />
      </Stack>
    </Stack>
  );
}
