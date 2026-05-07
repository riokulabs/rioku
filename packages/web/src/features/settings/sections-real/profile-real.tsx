/* eslint-disable react-hooks/set-state-in-effect -- form state hydrates from server fetch on first load; this is the correct pattern */
/**
 * Real-API ProfileSection — stage-2 wiring against generated daemon hooks.
 *
 * Replaces the mock-store-backed `<ProfileSection>` with a thin form that
 * reads via `useGetSettingsProfile` and patches via `usePatchSettingsProfile`
 * (Orval-generated, see `src/api/generated/settings/settings.ts`).
 *
 * Plan 07 — Task 1.
 */
import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Group,
  Loader,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import {
  useGetSettingsProfile,
  usePatchSettingsProfile,
} from '@/api/generated/settings/settings';
import { ValidationError } from '@/api/errors';
import { notify } from '@/hooks/use-notify';
import { unwrap } from './_unwrap';

interface ProfileRealSectionProps {
  tenant: string;
}

export function ProfileRealSection({ tenant }: ProfileRealSectionProps) {
  const query = useGetSettingsProfile(tenant);
  const patch = usePatchSettingsProfile();

  const [name, setName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [reducedMotion, setReducedMotion] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState(false);

  const profile = unwrap<{
    name?: string;
    email?: string;
    avatarUrl?: string;
    preferences?: Record<string, unknown>;
  }>(query.data);

  useEffect(() => {
    if (!profile || touched) return;
    setName(profile.name ?? '');
    setAvatarUrl(profile.avatarUrl ?? '');
    const prefs = profile.preferences;
    const rm = prefs?.reducedMotion;
    setReducedMotion(typeof rm === 'boolean' ? rm : false);
  }, [profile, touched]);

  if (query.isLoading) {
    return (
      <Stack align="center" py="xl" data-testid="profile-real-loading">
        <Loader />
        <Text size="sm">Loading profile…</Text>
      </Stack>
    );
  }

  if (query.isError) {
    return (
      <Alert color="red" data-testid="profile-real-error">
        Failed to load profile: {(query.error as Error).message}
      </Alert>
    );
  }

  async function onSave() {
    setFieldErrors({});
    try {
      await patch.mutateAsync({
        tenant,
        data: {
          name,
          avatarUrl,
          preferences: { reducedMotion },
        },
      });
      // Audit emission happens server-side on the PATCH; no client-side audit.
      notify.success('Profile updated');
      setTouched(false);
      await query.refetch();
    } catch (err) {
      if (err instanceof ValidationError && err.fields) {
        const flat: Record<string, string> = {};
        for (const [k, v] of Object.entries(err.fields)) {
          flat[k] = Array.isArray(v) ? v.join(', ') : String(v);
        }
        setFieldErrors(flat);
      } else {
        notify.error('Save failed', err instanceof Error ? err.message : 'Unknown');
      }
    }
  }

  return (
    <Stack gap="lg" data-testid="profile-real-section">
      <Stack gap="sm">
        <Title order={5}>Personal information</Title>
        <TextInput
          label="Name"
          value={name}
          onChange={(e) => {
            setName(e.currentTarget.value);
            setTouched(true);
          }}
          error={fieldErrors.name}
          data-testid="profile-real-name-input"
        />
        <TextInput
          label="Email"
          value={profile?.email ?? ''}
          readOnly
          disabled
          data-testid="profile-real-email-input"
        />
        <TextInput
          label="Avatar URL"
          value={avatarUrl}
          onChange={(e) => {
            setAvatarUrl(e.currentTarget.value);
            setTouched(true);
          }}
          error={fieldErrors.avatarUrl}
          data-testid="profile-real-avatar-input"
        />
      </Stack>

      <Stack gap="sm">
        <Title order={5}>Preferences</Title>
        <Switch
          label="Reduced motion"
          checked={reducedMotion}
          onChange={(e) => {
            setReducedMotion(e.currentTarget.checked);
            setTouched(true);
          }}
          data-testid="profile-real-reduced-motion"
        />
      </Stack>

      <Group justify="flex-end">
        <Button
          onClick={() => {
            void onSave();
          }}
          loading={patch.isPending}
          disabled={!touched}
          data-testid="profile-real-save"
        >
          Save
        </Button>
      </Group>
    </Stack>
  );
}
