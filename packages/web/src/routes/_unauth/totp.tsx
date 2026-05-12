/**
 * TOTP challenge page — step 2 of login.
 */
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { Title, Stack } from '@mantine/core';
import { TotpChallengeForm } from '@/features/auth/components/totp-challenge';

const totpSearchSchema = z.object({
  userId: z.string().optional(),
  return: z.string().optional(),
});

export const Route = createFileRoute('/_unauth/totp')({
  validateSearch: totpSearchSchema,
  component: TotpPage,
});

function TotpPage() {
  const { userId, return: returnUrl } = Route.useSearch();

  return (
    <Stack gap="lg">
      <Title order={2} ta="center">
        Two-factor authentication
      </Title>
      <TotpChallengeForm userId={userId} returnUrl={returnUrl} />
    </Stack>
  );
}
