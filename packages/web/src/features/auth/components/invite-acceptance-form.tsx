/**
 * <InviteAcceptanceForm> — accept a pending membership invite.
 *
 * Daemon endpoint: POST /api/v1/auth/invite/accept. There is no preview
 * endpoint, so the form posts the token + name + password directly. Daemon
 * returns 410 for invalid/expired/consumed tokens. On success the daemon
 * mints a session cookie and the SPA navigates to /.
 *
 * Plan 01 — stage 2 wiring.
 */
import { useState } from 'react';
import {
  Stack,
  TextInput,
  PasswordInput,
  Button,
  Alert,
  Text,
  Title,
  Anchor,
} from '@mantine/core';
import { useForm, schemaResolver } from '@mantine/form';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { IconAlertCircle } from '@tabler/icons-react';
import { z } from 'zod';
import { acceptInvite } from '../api';
import { currentUserQueryKey } from '../use-current-user';

interface InviteAcceptanceFormProps {
  token: string;
}

const inviteFormSchema = z
  .object({
    name: z.string().min(1, 'Your name is required'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirm: z.string().min(1, 'Please confirm your password'),
  })
  .refine((v) => v.password === v.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  });

type InviteFormValues = z.infer<typeof inviteFormSchema>;

export function InviteAcceptanceForm({ token }: InviteAcceptanceFormProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<InviteFormValues>({
    validate: schemaResolver(inviteFormSchema, { sync: true }),
    initialValues: { name: '', password: '', confirm: '' },
  });

  async function handleSubmit(values: InviteFormValues) {
    setSubmitting(true);
    setError(null);

    try {
      const result = await acceptInvite(token, {
        name: values.name,
        password: values.password,
      });
      if (!result.ok) {
        setError(result.error ?? 'Could not accept invite.');
        return;
      }
      await queryClient.invalidateQueries({ queryKey: currentUserQueryKey });
      await navigate({ to: '/' });
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Stack gap="lg">
      <Stack gap={4}>
        <Title order={3}>You&apos;ve been invited</Title>
        <Text size="sm">Set your name and a password to activate your account.</Text>
      </Stack>

      {error && (
        <Alert
          icon={<IconAlertCircle size={16} />}
          color="red"
          variant="light"
          data-testid="invite-error"
        >
          {error}
        </Alert>
      )}

      <form onSubmit={form.onSubmit((v) => void handleSubmit(v))}>
        <Stack gap="md">
          <TextInput
            label="Your name"
            placeholder="Jane Smith"
            data-autofocus
            required
            data-testid="invite-name-input"
            {...form.getInputProps('name')}
          />

          <PasswordInput
            label="Password"
            placeholder="At least 8 characters"
            autoComplete="new-password"
            required
            data-testid="invite-password-input"
            {...form.getInputProps('password')}
          />

          <PasswordInput
            label="Confirm password"
            placeholder="Repeat the password"
            autoComplete="new-password"
            required
            data-testid="invite-confirm-input"
            {...form.getInputProps('confirm')}
          />

          <Button type="submit" loading={submitting} fullWidth data-testid="invite-submit">
            Accept invite
          </Button>

          <Text size="sm" ta="center">
            <Anchor href="/login" size="sm">
              Already have an account? Sign in
            </Anchor>
          </Text>
        </Stack>
      </form>
    </Stack>
  );
}
