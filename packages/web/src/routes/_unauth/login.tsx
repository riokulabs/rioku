/**
 * Login page.
 * Task 1e.84
 */
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { Title, Stack } from '@mantine/core';
import { LoginForm } from '@/features/auth/components/login-form';

const loginSearchSchema = z.object({
  return: z.string().optional(),
});

export const Route = createFileRoute('/_unauth/login')({
  validateSearch: loginSearchSchema,
  component: LoginPage,
});

function LoginPage() {
  const { return: returnUrl } = Route.useSearch();

  return (
    <Stack gap="lg">
      <Title order={2} ta="center">
        Sign in to Rioku
      </Title>
      <LoginForm returnUrl={returnUrl} />
    </Stack>
  );
}
