/**
 * <ForgotPasswordForm> — request a password-reset email.
 *
 * Daemon endpoint: POST /api/v1/auth/password-reset/request — always returns
 * 202 regardless of whether the email matches a real user (anti-enumeration).
 * The SPA mirrors that with a generic "if an account exists, an email has
 * been sent" message.
 *
 * Plan 01 — stage 2 wiring.
 */
import { useState } from 'react';
import { Stack, TextInput, Button, Alert, Text, Anchor } from '@mantine/core';
import { useForm, schemaResolver } from '@mantine/form';
import { IconAlertCircle, IconInfoCircle } from '@tabler/icons-react';
import { requestPasswordReset } from '../api';
import { forgotPasswordSchema, type ForgotPasswordFormValues } from '../schemas';

export function ForgotPasswordForm() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);

  const form = useForm<ForgotPasswordFormValues>({
    validate: schemaResolver(forgotPasswordSchema, { sync: true }),
    initialValues: { email: '' },
  });

  async function handleSubmit(values: ForgotPasswordFormValues) {
    setSubmitting(true);
    setError(null);

    try {
      const result = await requestPasswordReset(values.email);
      if ('error' in result) {
        setError(result.error);
        return;
      }
      setSubmittedEmail(values.email);
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (submittedEmail !== null) {
    return (
      <Stack gap="md">
        <Alert
          icon={<IconInfoCircle size={16} />}
          color="green"
          variant="light"
          data-testid="reset-success-message"
        >
          If an account exists for <strong>{submittedEmail}</strong>, a password reset link has been
          sent. Check your inbox.
        </Alert>

        <Text size="sm" ta="center">
          <Anchor href="/login" size="sm">
            Back to sign in
          </Anchor>
        </Text>
      </Stack>
    );
  }

  return (
    <form onSubmit={form.onSubmit((v) => void handleSubmit(v))}>
      <Stack gap="md">
        {error && (
          <Alert
            icon={<IconAlertCircle size={16} />}
            color="red"
            variant="light"
            data-testid="forgot-error"
          >
            {error}
          </Alert>
        )}

        <Text size="sm">
          Enter your email address and we&apos;ll send you a link to reset your password.
        </Text>

        <TextInput
          label="Email"
          placeholder="you@example.com"
          type="email"
          autoComplete="email"
          data-autofocus
          required
          data-testid="forgot-email-input"
          {...form.getInputProps('email')}
        />

        <Button type="submit" loading={submitting} fullWidth data-testid="forgot-submit">
          Send reset link
        </Button>

        <Text size="sm" ta="center">
          <Anchor href="/login" size="sm">
            Back to sign in
          </Anchor>
        </Text>
      </Stack>
    </form>
  );
}
