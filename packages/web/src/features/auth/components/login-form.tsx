/**
 * <LoginForm> — username/email + password sign-in.
 *
 * On TOTP requirement, navigates to /totp; on success, hands off to either the
 * caller-supplied returnUrl, the saved sessionStorage return URL (set by the
 * 401 interceptor in `auth-failure.ts`), or `/` (root → router guards send the
 * user to the tenant picker).
 *
 * Plan 01 — stage 2 wiring.
 */
import { useState } from 'react';
import { Stack, TextInput, PasswordInput, Button, Alert, Anchor, Text } from '@mantine/core';
import { useForm, schemaResolver } from '@mantine/form';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { IconAlertCircle } from '@tabler/icons-react';
import { login } from '../api';
import { loginSchema, type LoginFormValues } from '../schemas';
import { consumeReturnUrl } from '@/api/auth-failure';
import { currentUserQueryKey } from '../use-current-user';

interface LoginFormProps {
  returnUrl?: string | undefined;
}

export function LoginForm({ returnUrl }: LoginFormProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<LoginFormValues>({
    validate: schemaResolver(loginSchema, { sync: true }),
    initialValues: { email: '', password: '' },
  });

  async function handleSubmit(values: LoginFormValues) {
    setSubmitting(true);
    setError(null);

    try {
      const result = await login(values.email, values.password);

      if ('error' in result) {
        setError(result.error);
        return;
      }

      if (result.requires_totp) {
        await navigate({
          to: '/totp',
          search: { userId: result.pending_user_id, return: returnUrl },
        });
        return;
      }

      // Refetch /auth/me so router guards re-evaluate against the new session.
      await queryClient.invalidateQueries({ queryKey: currentUserQueryKey });

      const saved = consumeReturnUrl();
      const dest = saved ?? returnUrl ?? '/';
      await navigate({ to: dest });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={form.onSubmit((v) => void handleSubmit(v))}>
      <Stack gap="md">
        {error && (
          <Alert
            icon={<IconAlertCircle size={16} />}
            color="red"
            variant="light"
            data-testid="login-error"
          >
            {error}
          </Alert>
        )}

        <TextInput
          label="Email"
          placeholder="you@example.com"
          type="email"
          autoComplete="email"
          data-autofocus
          required
          data-testid="email-input"
          {...form.getInputProps('email')}
        />

        <PasswordInput
          label="Password"
          placeholder="Your password"
          autoComplete="current-password"
          required
          data-testid="password-input"
          {...form.getInputProps('password')}
        />

        <Button type="submit" loading={submitting} fullWidth data-testid="login-submit">
          Sign in
        </Button>

        <Text size="sm" ta="center">
          <Anchor href="/forgot-password" size="sm">
            Forgot password?
          </Anchor>
          {' · '}
          <Anchor href="/totp-recovery" size="sm">
            Reset TOTP?
          </Anchor>
        </Text>
      </Stack>
    </form>
  );
}
