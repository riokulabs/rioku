/**
 * TOTP recovery page — backup code login.
 * Task 1e.87
 */
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { Title, Stack } from '@mantine/core';
import { TotpRecoveryForm } from '@/features/auth/components/totp-recovery';

const totpRecoverySearchSchema = z.object({
  return: z.string().optional(),
});

export const Route = createFileRoute('/_unauth/totp-recovery')({
  validateSearch: totpRecoverySearchSchema,
  component: TotpRecoveryPage,
});

function TotpRecoveryPage() {
  const { return: returnUrl } = Route.useSearch();

  return (
    <Stack gap="lg">
      <Title order={2} ta="center">
        Use a backup code
      </Title>
      <TotpRecoveryForm returnUrl={returnUrl} />
    </Stack>
  );
}
