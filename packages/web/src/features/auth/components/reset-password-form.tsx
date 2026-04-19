/**
 * <ResetPasswordForm> — set a new password via a reset token.
 *
 * Stage-1: token validation is relaxed (any mock-reset or force-reset token
 * with a known userId passes). Real cryptographic validation happens in the daemon.
 *
 * Task 1e.88
 */
import { useState, useEffect } from 'react';
import {
  Stack,
  PasswordInput,
  Button,
  Alert,
  Text,
  Checkbox,
  Progress,
  Group,
} from '@mantine/core';
import { useForm, schemaResolver } from '@mantine/form';
import { useNavigate } from '@tanstack/react-router';
import { IconAlertCircle, IconCheck } from '@tabler/icons-react';
import { validateResetToken, applyPasswordReset } from '../api';
import { resetPasswordSchema, type ResetPasswordFormValues } from '../schemas';

interface ResetPasswordFormProps {
  token: string;
}

/** Simple password strength gauge: 0–100 */
function passwordStrength(password: string): number {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 8) score += 20;
  if (password.length >= 12) score += 20;
  if (/[a-z]/.test(password)) score += 15;
  if (/[A-Z]/.test(password)) score += 15;
  if (/\d/.test(password)) score += 15;
  if (/[^a-zA-Z\d]/.test(password)) score += 15;
  return Math.min(100, score);
}

function strengthLabel(score: number): string {
  if (score < 30) return 'Weak';
  if (score < 60) return 'Fair';
  if (score < 80) return 'Good';
  return 'Strong';
}

function strengthColor(score: number): string {
  if (score < 30) return 'red';
  if (score < 60) return 'orange';
  if (score < 80) return 'yellow';
  return 'green';
}

export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const navigate = useNavigate();
  const [validating, setValidating] = useState(true);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [reEnrollTotp, setReEnrollTotp] = useState(false);

  const form = useForm<ResetPasswordFormValues>({
    validate: schemaResolver(resetPasswordSchema, { sync: true }),
    initialValues: { password: '', confirm: '' },
  });

  const passwordValue = form.values.password;
  const strength = passwordStrength(passwordValue);

  useEffect(() => {
    let cancelled = false;
    validateResetToken(token)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setUserId(result.user_id);
        } else {
          setTokenError(result.error);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTokenError('An error occurred validating the reset link.');
        }
      })
      .finally(() => {
        if (!cancelled) setValidating(false);
      });
    return () => {
      cancelled = true;
    };
  // Run once on mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(values: ResetPasswordFormValues) {
    if (!userId) return;
    setSubmitting(true);
    setSubmitError(null);

    try {
      const result = await applyPasswordReset(token, values.password);
      if (!result.ok) {
        setSubmitError(result.error ?? 'Failed to reset password.');
        return;
      }

      if (reEnrollTotp) {
        await navigate({ to: '/totp-enroll', search: { userId, return: undefined } });
      } else {
        // Navigate to tenant dashboard. Use mock store to get tenantId.
        const { useMockStore } = await import('@/api/mock-store');
        const tenantId = useMockStore.getState().currentTenantId;
        if (tenantId) {
          const tenants = useMockStore.getState().tenants;
          const tenant = tenants[tenantId];
          if (tenant) {
            await navigate({ to: '/t/$tenant/dashboard', params: { tenant: tenant.slug } });
            return;
          }
        }
        await navigate({ to: '/login' });
      }
    } catch {
      setSubmitError('An unexpected error occurred. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (validating) {
    return <Text c="dimmed">Validating reset link…</Text>;
  }

  if (tokenError) {
    return (
      <Stack gap="md">
        <Alert
          icon={<IconAlertCircle size={16} />}
          color="red"
          variant="light"
          data-testid="reset-token-error"
        >
          {tokenError}
        </Alert>
        <Text size="sm" ta="center">
          <a href="/forgot-password">Request a new reset link</a>
        </Text>
      </Stack>
    );
  }

  return (
    <form onSubmit={form.onSubmit((v) => void handleSubmit(v))}>
      <Stack gap="md">
        {submitError && (
          <Alert
            icon={<IconAlertCircle size={16} />}
            color="red"
            variant="light"
            data-testid="reset-submit-error"
          >
            {submitError}
          </Alert>
        )}

        <PasswordInput
          label="New password"
          placeholder="At least 8 characters"
          autoComplete="new-password"
          data-autofocus
          required
          data-testid="new-password-input"
          {...form.getInputProps('password')}
        />

        {/* Password strength gauge */}
        {passwordValue.length > 0 && (
          <Stack gap={4}>
            <Progress
              value={strength}
              color={strengthColor(strength)}
              size="sm"
              data-testid="password-strength-bar"
            />
            <Group justify="space-between">
              <Text size="xs" c="dimmed">
                Strength
              </Text>
              <Text size="xs" c={strengthColor(strength)} fw={500}>
                {strengthLabel(strength)}
              </Text>
            </Group>
          </Stack>
        )}

        <PasswordInput
          label="Confirm new password"
          placeholder="Repeat the password"
          autoComplete="new-password"
          required
          data-testid="confirm-password-input"
          {...form.getInputProps('confirm')}
        />

        <Checkbox
          label="Re-enroll TOTP authenticator after reset"
          checked={reEnrollTotp}
          onChange={(e) => { setReEnrollTotp(e.currentTarget.checked); }}
          data-testid="reenroll-totp-checkbox"
        />

        <Button
          type="submit"
          loading={submitting}
          fullWidth
          leftSection={strength >= 60 ? <IconCheck size={16} /> : undefined}
          data-testid="reset-submit"
        >
          Reset password
        </Button>
      </Stack>
    </form>
  );
}
