/* eslint-disable react-hooks/set-state-in-effect -- form state hydrates from server fetch on first load; this is the correct pattern */
/**
 * Real-API Auth-policy section — stage-2 wiring.
 * Reads via `useGetSettingsAuthPolicy`, replaces via `usePutSettingsAuthPolicy`.
 * Plan 07 — Task 3.
 */
import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Group,
  Loader,
  NumberInput,
  Select,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import {
  useGetSettingsAuthPolicy,
  usePutSettingsAuthPolicy,
} from '@/api/generated/settings/settings';
import { ValidationError } from '@/api/errors';
import { notify } from '@/hooks/use-notify';
import { unwrap } from './_unwrap';

interface AuthPolicyRealSectionProps {
  tenant: string;
}

export function AuthPolicyRealSection({ tenant }: AuthPolicyRealSectionProps) {
  const query = useGetSettingsAuthPolicy(tenant);
  const put = usePutSettingsAuthPolicy();

  const [totp, setTotp] = useState<'all' | 'admins' | 'optional'>('admins');
  const [pwdMin, setPwdMin] = useState(12);
  const [idle, setIdle] = useState(900);
  const [absolute, setAbsolute] = useState(86400);
  const [touched, setTouched] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const data = unwrap<{
    totpPolicy?: string;
    passwordMinLength?: number;
    idleSessionTimeoutSeconds?: number;
    absoluteSessionTimeoutSeconds?: number;
  }>(query.data);
  useEffect(() => {
    if (!data || touched) return;
    setTotp((data.totpPolicy as 'all' | 'admins' | 'optional' | undefined) ?? 'admins');
    setPwdMin(data.passwordMinLength ?? 12);
    setIdle(data.idleSessionTimeoutSeconds ?? 900);
    setAbsolute(data.absoluteSessionTimeoutSeconds ?? 86400);
  }, [data, touched]);

  if (query.isLoading)
    return (
      <Stack align="center" py="xl" data-testid="auth-policy-real-loading">
        <Loader />
      </Stack>
    );
  if (query.isError)
    return (
      <Alert color="red" data-testid="auth-policy-real-error">
        Failed to load: {(query.error as Error).message}
      </Alert>
    );

  async function onSave() {
    setFieldErrors({});
    try {
      await put.mutateAsync({
        tenant,
        data: {
          totpPolicy: totp,
          passwordMinLength: pwdMin,
          idleSessionTimeoutSeconds: idle,
          absoluteSessionTimeoutSeconds: absolute,
        },
      });
      notify.success('Auth policy saved');
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
    <Stack gap="lg" data-testid="auth-policy-real-section">
      <Title order={5}>Authentication policy</Title>
      <Select
        label="TOTP policy"
        value={totp}
        onChange={(v) => {
          setTotp((v) ?? 'admins');
          setTouched(true);
        }}
        data={[
          { value: 'all', label: 'Required for all users' },
          { value: 'admins', label: 'Required for admins only' },
          { value: 'optional', label: 'Optional' },
        ]}
        data-testid="auth-policy-real-totp"
      />
      <NumberInput
        label="Password minimum length"
        value={pwdMin}
        min={6}
        max={256}
        onChange={(v) => {
          setPwdMin(typeof v === 'number' ? v : 12);
          setTouched(true);
        }}
        error={fieldErrors.passwordMinLength}
        data-testid="auth-policy-real-pwd-min"
      />
      <NumberInput
        label="Idle session timeout (s)"
        value={idle}
        min={60}
        onChange={(v) => {
          setIdle(typeof v === 'number' ? v : 900);
          setTouched(true);
        }}
        data-testid="auth-policy-real-idle"
      />
      <NumberInput
        label="Absolute session timeout (s)"
        value={absolute}
        min={60}
        onChange={(v) => {
          setAbsolute(typeof v === 'number' ? v : 86400);
          setTouched(true);
        }}
        data-testid="auth-policy-real-absolute"
      />
      <Group justify="flex-end">
        <Button
          onClick={() => {
            void onSave();
          }}
          loading={put.isPending}
          disabled={!touched}
          data-testid="auth-policy-real-save"
        >
          Save
        </Button>
      </Group>
      <Text size="xs" c="dimmed">
        Audit emitted server-side.
      </Text>
    </Stack>
  );
}
