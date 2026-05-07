/**
 * <ResetPasswordForm> — set a new password via a reset token.
 *
 * Validates the token via GET /auth/password-reset/validate?token=… on mount
 * (200 ⇒ token usable, 410 ⇒ expired/consumed). Submits the new password to
 * POST /auth/password-reset/apply, which marks the token consumed in one
 * transaction.
 *
 * Plan 01 — stage 2 wiring.
 */
import { useState, useEffect } from 'react';
import {
  Stack,
  PasswordInput,
  Button,
  Alert,
  Text,
  Anchor,
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
  const [tokenValid, setTokenValid] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

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
          setTokenValid(true);
        } else {
          setTokenError(result.error);
        }
      })
      .catch(() => {
        if (!cancelled) setTokenError('An error occurred validating the reset link.');
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
    if (!tokenValid) return;
    setSubmitting(true);
    setSubmitError(null);

    try {
      const result = await applyPasswordReset(token, values.password);
      if (!result.ok) {
        setSubmitError(result.error ?? 'Failed to reset password.');
        return;
      }
      setSuccess(true);
      await new Promise<void>((resolve) => setTimeout(resolve, 1200));
      await navigate({ to: '/login' });
    } catch {
      setSubmitError('An unexpected error occurred. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (validating) {
    return <Text>Validating reset link…</Text>;
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
          <Anchor href="/forgot-password">Request a new reset link</Anchor>
        </Text>
      </Stack>
    );
  }

  if (success) {
    return (
      <Alert
        icon={<IconCheck size={16} />}
        color="green"
        variant="light"
        data-testid="reset-success"
      >
        Password reset. Redirecting to sign-in…
      </Alert>
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

        {passwordValue.length > 0 && (
          <Stack gap={4}>
            <Progress
              value={strength}
              color={strengthColor(strength)}
              size="sm"
              data-testid="password-strength-bar"
            />
            <Group justify="space-between">
              <Text size="xs">Strength</Text>
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
