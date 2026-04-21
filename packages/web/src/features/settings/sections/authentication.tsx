/**
 * <AuthenticationSection> — settings authentication section.
 *
 * Renders 4 subsections:
 *   1. TOTP policy (SegmentedControl)
 *   2. Password policy (NumberInputs + Switches)
 *   3. Session timeouts (NumberInputs)
 *   4. SSO placeholders (greyed-out OAuth + SAML panels)
 *
 * Requires `tenant-auth:write` for all mutations. Read is always visible.
 *
 * Task 8a.4
 */
import { useState, useEffect } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Fieldset,
  Group,
  NumberInput,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Tooltip,
} from '@mantine/core';
import { useForm, schemaResolver } from '@mantine/form';
import { IconAlertCircle, IconLock } from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import { usePermission } from '@/hooks/use-permission';
import { useCurrentTenant, useCurrentTenantAuthPolicy, updateTenantAuthPolicy } from '../api';
import { tenantAuthPolicySchema } from '../schemas';
import type { TenantAuthPolicyValues } from '../schemas';

// ─── TOTP policy labels ───────────────────────────────────────────────────────

const TOTP_POLICY_DATA = [
  { value: 'all', label: 'Enforce for all' },
  { value: 'admins', label: 'Enforce for admins' },
  { value: 'optional', label: 'Optional' },
] as const;

// ─── Default values ───────────────────────────────────────────────────────────

const DEFAULT_VALUES: TenantAuthPolicyValues = {
  totp_policy: 'admins',
  password_policy: {
    min_length: 12,
    require_uppercase: true,
    require_digit: true,
    require_symbol: false,
    max_age_days: 0,
    history_depth: 5,
  },
  session_timeouts: {
    idle_hours: 8,
    absolute_hours: 24,
  },
};

// ─── Component ────────────────────────────────────────────────────────────────

export function AuthenticationSection() {
  const tenant = useCurrentTenant();
  const policy = useCurrentTenantAuthPolicy();
  const canWrite = usePermission('tenant-auth:write');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initialValues: TenantAuthPolicyValues = policy
    ? {
        totp_policy: policy.totp_policy,
        password_policy: {
          min_length: policy.password_policy.min_length,
          require_uppercase: policy.password_policy.require_uppercase,
          require_digit: policy.password_policy.require_digit,
          require_symbol: policy.password_policy.require_symbol,
          max_age_days: policy.password_policy.max_age_days,
          history_depth: policy.password_policy.history_depth,
        },
        session_timeouts: {
          idle_hours: policy.session_timeouts.idle_hours,
          absolute_hours: policy.session_timeouts.absolute_hours,
        },
      }
    : DEFAULT_VALUES;

  const form = useForm<TenantAuthPolicyValues>({
    initialValues,
    validate: schemaResolver(tenantAuthPolicySchema, { sync: true }),
  });

  // Reset form when tenant changes (e.g. on tenant switch)
  useEffect(() => {
    if (policy) {
      form.setValues({
        totp_policy: policy.totp_policy,
        password_policy: {
          min_length: policy.password_policy.min_length,
          require_uppercase: policy.password_policy.require_uppercase,
          require_digit: policy.password_policy.require_digit,
          require_symbol: policy.password_policy.require_symbol,
          max_age_days: policy.password_policy.max_age_days,
          history_depth: policy.password_policy.history_depth,
        },
        session_timeouts: {
          idle_hours: policy.session_timeouts.idle_hours,
          absolute_hours: policy.session_timeouts.absolute_hours,
        },
      });
      form.resetDirty();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant?.id]);

  async function handleSubmit(values: TenantAuthPolicyValues) {
    if (!tenant) return;
    setLoading(true);
    setError(null);
    try {
      await updateTenantAuthPolicy(tenant.id, {
        totp_policy: values.totp_policy,
        password_policy: { ...values.password_policy },
        session_timeouts: { ...values.session_timeouts },
      });
      notify.success('Authentication policy saved', 'Auth settings updated successfully.');
      form.resetDirty(values);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save auth policy';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={form.onSubmit((v) => { void handleSubmit(v); })}
      data-testid="auth-policy-form"
    >
      <Stack gap="md">
        {error && (
          <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">
            {error}
          </Alert>
        )}

        {/* ── TOTP policy ─────────────────────────────────────────────────── */}
        <Fieldset legend="TOTP policy" data-testid="auth-totp-fieldset">
          <Stack gap="xs">
            <Text size="sm">
              Controls which users are required to enroll a TOTP authenticator app before
              they can log in.
            </Text>
            <SegmentedControl
              data={TOTP_POLICY_DATA as unknown as { value: string; label: string }[]}
              value={form.values.totp_policy}
              onChange={(value) => { form.setFieldValue('totp_policy', value as TenantAuthPolicyValues['totp_policy']); }}
              disabled={!canWrite}
              data-testid="auth-totp-policy"
            />
          </Stack>
        </Fieldset>

        {/* ── Password policy ──────────────────────────────────────────────── */}
        <Fieldset legend="Password policy" data-testid="auth-password-fieldset">
          <Stack gap="sm">
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
              <NumberInput
                label="Minimum length"
                description="Characters required (6–128)."
                min={6}
                max={128}
                required
                disabled={!canWrite}
                data-testid="auth-password-min-length"
                {...form.getInputProps('password_policy.min_length')}
              />
              <NumberInput
                label="History depth"
                description="Prevent reuse of last N passwords (0 = disabled)."
                min={0}
                max={24}
                required
                disabled={!canWrite}
                data-testid="auth-password-history-depth"
                {...form.getInputProps('password_policy.history_depth')}
              />
              <NumberInput
                label="Max age (days)"
                description="Force password change after N days. Set 0 to never expire."
                min={0}
                max={3650}
                required
                disabled={!canWrite}
                data-testid="auth-password-max-age"
                {...form.getInputProps('password_policy.max_age_days')}
              />
            </SimpleGrid>

            <Stack gap="xs" mt="xs">
              <Switch
                label="Require uppercase letter"
                disabled={!canWrite}
                data-testid="auth-password-require-uppercase"
                checked={form.values.password_policy.require_uppercase}
                onChange={(e) => { form.setFieldValue('password_policy.require_uppercase', e.currentTarget.checked); }}
              />
              <Switch
                label="Require digit"
                disabled={!canWrite}
                data-testid="auth-password-require-digit"
                checked={form.values.password_policy.require_digit}
                onChange={(e) => { form.setFieldValue('password_policy.require_digit', e.currentTarget.checked); }}
              />
              <Switch
                label="Require symbol"
                disabled={!canWrite}
                data-testid="auth-password-require-symbol"
                checked={form.values.password_policy.require_symbol}
                onChange={(e) => { form.setFieldValue('password_policy.require_symbol', e.currentTarget.checked); }}
              />
            </Stack>
          </Stack>
        </Fieldset>

        {/* ── Session timeouts ─────────────────────────────────────────────── */}
        <Fieldset legend="Session timeouts" data-testid="auth-session-fieldset">
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
            <NumberInput
              label="Idle timeout (hours)"
              description="Log out after N hours of inactivity. Set 0 to disable."
              min={0}
              max={168}
              required
              disabled={!canWrite}
              data-testid="auth-session-idle-hours"
              {...form.getInputProps('session_timeouts.idle_hours')}
            />
            <NumberInput
              label="Absolute timeout (hours)"
              description="Force re-login after N hours regardless of activity (1–720)."
              min={1}
              max={720}
              required
              disabled={!canWrite}
              data-testid="auth-session-absolute-hours"
              {...form.getInputProps('session_timeouts.absolute_hours')}
            />
          </SimpleGrid>
        </Fieldset>

        {/* ── SSO (coming soon) ────────────────────────────────────────────── */}
        <Fieldset legend="SSO" data-testid="auth-sso-fieldset">
          <Stack gap="sm">
            <Text size="sm" c="var(--mantine-color-gray-7)">
              Single Sign-On integrations will be available in a future release.
            </Text>
            {/* Boxes use explicit dimmed colors rather than opacity so that
                axe can compute real contrast ratios. opacity:0.5 on a
                container halves the effective contrast of all child text,
                causing WCAG AA failures even when the base color is correct.
                The visual muted effect comes from using dimmed text/border
                instead. Task 9a.1. */}
            <Box
              p="sm"
              style={{
                border: '1px solid var(--mantine-color-dimmed)',
                borderRadius: 'var(--mantine-radius-sm)',
                cursor: 'not-allowed',
              }}
              data-testid="auth-sso-oauth-panel"
            >
              <Group justify="space-between">
                <Group gap="xs">
                  <IconLock size={16} color="var(--mantine-color-dimmed)" />
                  <Text size="sm" fw={500} c="dimmed">OAuth</Text>
                </Group>
                <Badge variant="outline" size="sm" color="gray" data-testid="auth-sso-oauth-badge">
                  Coming soon
                </Badge>
              </Group>
            </Box>
            <Box
              p="sm"
              style={{
                border: '1px solid var(--mantine-color-dimmed)',
                borderRadius: 'var(--mantine-radius-sm)',
                cursor: 'not-allowed',
              }}
              data-testid="auth-sso-saml-panel"
            >
              <Group justify="space-between">
                <Group gap="xs">
                  <IconLock size={16} color="var(--mantine-color-dimmed)" />
                  <Text size="sm" fw={500} c="dimmed">SAML</Text>
                </Group>
                <Badge variant="outline" size="sm" color="gray" data-testid="auth-sso-saml-badge">
                  Coming soon
                </Badge>
              </Group>
            </Box>
          </Stack>
        </Fieldset>

        {/* ── Save button ──────────────────────────────────────────────────── */}
        <Group justify="flex-end" gap="sm">
          <Tooltip
            label="You don't have permission to edit authentication settings"
            disabled={canWrite}
            withArrow
          >
            <span>
              <Button
                type="submit"
                loading={loading}
                disabled={!canWrite || !form.isDirty()}
                data-testid="auth-policy-save"
              >
                Save authentication settings
              </Button>
            </span>
          </Tooltip>
        </Group>
      </Stack>
    </form>
  );
}
