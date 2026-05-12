/**
 * /admin/impersonate — impersonation entry form route.
 *
 * Requires: user:impersonate + admin:cross-tenant-write (any one of)
 * Wrapped by AdminLayout via parent /admin route.
 *
 */
import { createFileRoute } from '@tanstack/react-router';
import { requirePermissions } from '@/hooks/use-before-load';
import { ImpersonationEntryForm } from '@/features/security/impersonation';
import { Stack, Title, Text } from '@mantine/core';

export const Route = createFileRoute('/admin/impersonate')({
  beforeLoad: requirePermissions({
    required: ['user:impersonate', 'admin:cross-tenant-write'],
    requireAny: true,
  }),
  component: ImpersonatePage,
});

function ImpersonatePage() {
  return (
    <Stack gap="lg" maw={560}>
      <div>
        <Title order={3}>Start impersonation session</Title>
        <Text c="dimmed" size="sm" mt={4}>
          Enter a tenant to act as super-admin. The session is time-limited and logged to both the
          super-admin audit log and the target tenant&apos;s audit log.
        </Text>
      </div>
      <ImpersonationEntryForm />
    </Stack>
  );
}
