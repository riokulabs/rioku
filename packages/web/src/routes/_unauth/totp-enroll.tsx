/**
 * TOTP enrollment page.
 * Task 1e.86
 */
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { Title, Stack } from '@mantine/core';
import { TotpEnrollForm } from '@/features/auth/components/totp-enroll';

const totpEnrollSearchSchema = z.object({
  userId: z.string().optional(),
  return: z.string().optional(),
});

export const Route = createFileRoute('/_unauth/totp-enroll')({
  validateSearch: totpEnrollSearchSchema,
  component: TotpEnrollPage,
});

function TotpEnrollPage() {
  const { userId, return: returnUrl } = Route.useSearch();

  return (
    <Stack gap="lg">
      <Title order={2} ta="center">
        Set up two-factor authentication
      </Title>
      <TotpEnrollForm userId={userId} returnUrl={returnUrl} />
    </Stack>
  );
}
