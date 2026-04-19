/**
 * Forgot-password page.
 * Task 1e.88
 */
import { createFileRoute } from '@tanstack/react-router';
import { Title, Stack } from '@mantine/core';
import { ForgotPasswordForm } from '@/features/auth/components/forgot-password-form';

export const Route = createFileRoute('/_unauth/forgot-password')({
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  return (
    <Stack gap="lg">
      <Title order={2} ta="center">
        Forgot your password?
      </Title>
      <ForgotPasswordForm />
    </Stack>
  );
}
