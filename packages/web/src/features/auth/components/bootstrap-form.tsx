/**
 * <BootstrapForm> — first-run setup: creates the root tenant + root user.
 *
 * Hits `POST /api/v1/auth/bootstrap`. The daemon does not auto-create a
 * session on bootstrap — after success the user is sent to `/login`.
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
  Divider,
  Title,
  Progress,
  Group,
} from '@mantine/core';
import { useForm, schemaResolver } from '@mantine/form';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { IconAlertCircle } from '@tabler/icons-react';
import { bootstrap } from '../api';
import { bootstrapStatusQueryKey } from '../use-bootstrap-status';
import { bootstrapSchema, type BootstrapFormValues } from '../schemas';

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

function strengthColor(score: number): string {
  if (score < 30) return 'red';
  if (score < 60) return 'orange';
  if (score < 80) return 'yellow';
  return 'green';
}

function strengthLabel(score: number): string {
  if (score < 30) return 'Weak';
  if (score < 60) return 'Fair';
  if (score < 80) return 'Good';
  return 'Strong';
}

export function BootstrapForm() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const form = useForm<BootstrapFormValues>({
    validate: schemaResolver(bootstrapSchema, { sync: true }),
    initialValues: {
      name: '',
      email: '',
      password: '',
      confirm: '',
      tenant_name: '',
      tenant_slug: '',
    },
  });

  const passwordValue = form.values.password;
  const strength = passwordStrength(passwordValue);

  async function handleSubmit(values: BootstrapFormValues) {
    setSubmitting(true);
    setError(null);

    try {
      const result = await bootstrap({
        email: values.email,
        name: values.name,
        password: values.password,
        tenant_name: values.tenant_name,
        tenant_slug: values.tenant_slug,
      });

      if (!result.ok) {
        setError(result.error ?? 'Bootstrap failed.');
        return;
      }

      await queryClient.invalidateQueries({ queryKey: bootstrapStatusQueryKey });
      setSuccess(true);
      await navigate({ to: '/login' });
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <Stack gap="md">
        <Alert color="green" variant="light" data-testid="bootstrap-success">
          Organization created. Redirecting to sign-in…
        </Alert>
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
            data-testid="bootstrap-error"
          >
            {error}
          </Alert>
        )}

        <Title order={4}>Organization</Title>

        <TextInput
          label="Organization name"
          placeholder="Acme Corp"
          required
          data-autofocus
          data-testid="bootstrap-tenant-name"
          {...form.getInputProps('tenant_name')}
        />

        <TextInput
          label="Organization slug"
          placeholder="acme-corp"
          description="URL-safe identifier: lowercase letters, numbers, hyphens."
          required
          data-testid="bootstrap-tenant-slug"
          {...form.getInputProps('tenant_slug')}
        />

        <Divider label="Root user account" labelPosition="center" />

        <TextInput
          label="Your name"
          placeholder="Jane Smith"
          required
          data-testid="bootstrap-name"
          {...form.getInputProps('name')}
        />

        <TextInput
          label="Email"
          placeholder="you@example.com"
          type="email"
          autoComplete="email"
          required
          data-testid="bootstrap-email"
          {...form.getInputProps('email')}
        />

        <PasswordInput
          label="Password"
          placeholder="At least 8 characters"
          autoComplete="new-password"
          required
          data-testid="bootstrap-password"
          {...form.getInputProps('password')}
        />

        {passwordValue.length > 0 && (
          <Stack gap={4}>
            <Progress
              value={strength}
              color={strengthColor(strength)}
              size="sm"
              data-testid="bootstrap-strength-bar"
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
          label="Confirm password"
          placeholder="Repeat the password"
          autoComplete="new-password"
          required
          data-testid="bootstrap-confirm"
          {...form.getInputProps('confirm')}
        />

        <Button type="submit" loading={submitting} fullWidth data-testid="bootstrap-submit">
          Create organization
        </Button>
      </Stack>
    </form>
  );
}
