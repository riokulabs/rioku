/**
 * Invite acceptance page — reads token from route param.
 */
import { createFileRoute } from '@tanstack/react-router';
import { Title, Stack } from '@mantine/core';
import { InviteAcceptanceForm } from '@/features/auth/components/invite-acceptance-form';

export const Route = createFileRoute('/_unauth/invite/$token')({
  component: InvitePage,
});

function InvitePage() {
  const { token } = Route.useParams();

  return (
    <Stack gap="lg">
      <Title order={2} ta="center">
        Accept your invitation
      </Title>
      <InviteAcceptanceForm token={token} />
    </Stack>
  );
}
