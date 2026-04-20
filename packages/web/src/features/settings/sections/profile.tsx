/**
 * <ProfileSection> — settings profile section.
 *
 * Renders 5 subsections:
 *   1. Personal info  — name (inline-edit), email (read-only), avatar uploader
 *   2. Password       — "Change password" button → modal
 *   3. TOTP           — enrollment status, re-enroll link, reset backup codes
 *   4. Passkeys       — coming soon placeholder
 *   5. Preferences    — theme, locale, timezone, reduced motion, notifications
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
import { IconAlertCircle, IconKey, IconShieldCheck, IconShieldOff } from '@tabler/icons-react';
import { Link } from '@tanstack/react-router';
import { notify } from '@/hooks/use-notify';
import { usePermission } from '@/hooks/use-permission';
import { useMockStore } from '@/api/mock-store';
import { useCurrentUser, resetBackupCodes } from '../api';
import { ProfilePersonalInfo } from './profile-personal-info';
import { ProfilePasswordModal } from './profile-password-modal';
import { ProfilePreferences } from './profile-preferences';

export function ProfileSection() {
  const user = useCurrentUser();
  const canUpdate = usePermission('user:update-own');
  const tenantSlug = useMockStore((s) => {
    const tenant = s.tenants[s.currentTenantId ?? ''];
    return tenant?.slug ?? '';
  });

  const [passwordOpened, { open: openPassword, close: closePassword }] =
    useDisclosure(false);

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

      {/* ── 2. Password ────────────────────────────────────────────────── */}
      <Stack gap="sm" data-testid="profile-password-section">
        <Title order={5}>Password</Title>
        <Text size="sm" c="var(--mantine-color-gray-7)">
          {user.force_password_change
            ? 'You are required to change your password.'
            : 'Update your account password.'}
        </Text>
        {user.force_password_change && (
          <Alert icon={<IconAlertCircle size={14} />} color="yellow" variant="light">
            A password change is required before your next login.
          </Alert>
        )}
        <Tooltip
          label="You don't have permission to update your profile"
          disabled={canUpdate}
          withArrow
        >
          <span style={{ alignSelf: 'flex-start' }}>
            <Button
              variant="default"
              onClick={openPassword}
              disabled={!canUpdate}
              data-testid="profile-change-password-btn"
            >
              Change password
            </Button>
          </span>
        </Tooltip>
        <ProfilePasswordModal
          userId={user.id}
          opened={passwordOpened}
          onClose={closePassword}
        />
      </Stack>

      <Divider />

      {/* ── 3. TOTP ────────────────────────────────────────────────────── */}
      <Stack gap="sm" data-testid="profile-totp-section">
        <Group gap="sm">
          <Title order={5}>Two-factor authentication (TOTP)</Title>
          {user.totp_enrolled ? (
            <Badge
              color="green"
              variant="light"
              leftSection={<IconShieldCheck size={12} />}
              data-testid="profile-totp-status-enrolled"
            >
              Enrolled
            </Badge>
          ) : (
            <Badge
              color="orange"
              variant="light"
              leftSection={<IconShieldOff size={12} />}
              data-testid="profile-totp-status-not-enrolled"
            >
              Not enrolled
            </Badge>
          )}
        </Group>
        <Text size="sm" c="var(--mantine-color-gray-7)">
          {user.totp_enrolled
            ? 'TOTP is active on your account. You can re-enroll to rotate your authenticator secret.'
            : 'Enable TOTP to add a second factor to your login.'}
        </Text>
        <Group gap="sm">
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
            <>
              {codesError && (
                <Text size="xs" c="red">
                  {codesError}
                </Text>
              )}
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
                    onClick={() => { void handleResetBackupCodes(); }}
                    data-testid="profile-backup-codes-reset"
                  >
                    Reset backup codes
                  </Button>
                </span>
              </Tooltip>
            </>
          )}
        </Group>
      </Stack>

      <Divider />

      {/* ── 4. Passkeys ────────────────────────────────────────────────── */}
      <Stack gap="sm" data-testid="profile-passkeys-section">
        <Group gap="sm">
          <Title order={5}>Passkeys</Title>
          <Badge
            color="gray"
            variant="light"
            leftSection={<IconKey size={12} />}
          >
            Coming soon
          </Badge>
        </Group>
        <Text size="sm" c="var(--mantine-color-gray-7)">
          Passkey support (WebAuthn) is planned for a future release. Once
          available, you will be able to add hardware keys or biometric
          authenticators as login credentials.
        </Text>
      </Stack>

      <Divider />

      {/* ── 5. Preferences ─────────────────────────────────────────────── */}
      <Stack gap="sm" data-testid="profile-preferences-section">
        <Title order={5}>Preferences</Title>
        <ProfilePreferences user={user} />
      </Stack>
    </Stack>
  );
}
