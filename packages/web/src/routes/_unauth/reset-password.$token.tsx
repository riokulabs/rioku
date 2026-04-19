/**
 * Reset-password page — reads token from route param.
 * Task 1e.88
 */
import { createFileRoute } from '@tanstack/react-router';
import { Title, Stack } from '@mantine/core';
import { ResetPasswordForm } from '@/features/auth/components/reset-password-form';

export const Route = createFileRoute('/_unauth/reset-password/$token')({
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { token } = Route.useParams();

  return (
    <Stack gap="lg">
      <Title order={2} ta="center">
        Reset your password
      </Title>
      <ResetPasswordForm token={token} />
    </Stack>
  );
}
