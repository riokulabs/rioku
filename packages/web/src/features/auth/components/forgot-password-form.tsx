/**
 * <ForgotPasswordForm> — request a password reset link.
 *
 * Stage-1: Shows the mock reset link inline (no SMTP). In production, the
 * daemon emails this link to the user.
 *
 * Task 1e.88
 */
import { useState } from 'react';
import { Stack, TextInput, Button, Alert, Text, Paper, Group, Anchor, Badge } from '@mantine/core';
import { useForm, schemaResolver } from '@mantine/form';
import { useNavigate } from '@tanstack/react-router';
import { IconAlertCircle, IconInfoCircle } from '@tabler/icons-react';
import { requestPasswordReset } from '../api';
import { forgotPasswordSchema, type ForgotPasswordFormValues } from '../schemas';
import { IdBadge } from '@/components/id-badge';

export function ForgotPasswordForm() {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mockLink, setMockLink] = useState<string | null>(null);
  const [submittedEmail, setSubmittedEmail] = useState('');

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
      setMockLink(result.mock_reset_link);
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (mockLink) {
    // Extract token from mock link path: /reset-password/<token>
    const token = mockLink.split('/').pop() ?? '';

    return (
      <Stack gap="md">
        <Alert
          icon={<IconInfoCircle size={16} />}
          color="green"
          variant="light"
          data-testid="reset-success-message"
        >
          If an account exists for <strong>{submittedEmail}</strong>, a reset link has been sent.
          (If this is your email, check your inbox.)
        </Alert>

        {/* Stage-1 dev helper — no-op in production */}
        <Paper withBorder p="md" data-testid="stage1-mock-link-block">
          <Stack gap="sm">
            <Badge color="orange" variant="light" size="sm">
              Stage-1 mock — no email sent. In production, this link is emailed to the user.
            </Badge>
            <Text size="sm" fw={500}>
              Mock reset link (copy or click):
            </Text>
            <IdBadge id={mockLink} label={mockLink} />
            <Group gap="xs" mt="xs">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void navigator.clipboard.writeText(`${window.location.origin}${mockLink}`);
                }}
                data-testid="copy-reset-link"
              >
                Click to copy
              </Button>
              <Button
                size="sm"
                onClick={() => void navigate({ to: '/reset-password/$token', params: { token } })}
                data-testid="use-reset-link"
              >
                Use this link
              </Button>
            </Group>
          </Stack>
        </Paper>

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
