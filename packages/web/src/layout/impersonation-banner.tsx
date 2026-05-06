/**
 * <ImpersonationBanner> — unmissable amber sticky banner shown during an
 * active impersonation session.
 *
 * - Renders when useImpersonation().session is non-null.
 * - Returns null when no session is active.
 * - Sticky at the top of the viewport — does not scroll away.
 * - Shows: tenant, reason, short session ID, optional ticket ref link, exit button.
 * - Exit calls useImpersonation().exit() then navigates to /admin.
 * - Exit prompts a confirm modal because leaving a session is significant.
 *
 * Layout placement: rendered as a sibling above <AppShell> so it is present on
 * both tenant pages (AppLayout) and admin pages (AdminLayout). The parent
 * div in app-layout.tsx positions it outside AppShell's header slot to avoid
 * conflicting with the TopBar.
 *
 * spec §8.2 / Task 1d.76
 */
import { Alert, Group, Text, Button, Anchor, Badge } from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconEye } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useMockStore } from '@/api/mock-store';
import { isRealApi } from '@/api/mode';
import { useImpersonation } from '@/hooks/use-impersonation';
import { useImpersonationSession } from '@/features/security/impersonation/use-impersonation-session';
import {
  useEndImpersonation,
  getListImpersonationSessionsQueryKey,
} from '@/features/security/impersonation/realApi';
import { ImpersonationIdleModal } from '@/features/security/impersonation/components/idle-modal';

// ─── Component ────────────────────────────────────────────────────────────────

export function ImpersonationBanner() {
  const { session: mockSession, exit } = useImpersonation();
  // RD: when real-API mode is enabled, prefer the daemon-reported
  // session over the mock store. In mock mode the bridge hook returns
  // the same value as `useImpersonation().session`.
  const realSession = useImpersonationSession();
  const session = realSession ?? mockSession;
  const navigate = useNavigate();
  const tenants = useMockStore((s) => s.tenants);
  const queryClient = useQueryClient();
  const endMutation = useEndImpersonation();

  if (!session) return null;
  // Stable reference for use inside async closures where TS narrowing
  // does not propagate (the session field is read inside `onConfirm`).
  const liveSession = session;

  const tenant = tenants[session.tenant_id];
  const tenantName = tenant?.name ?? session.tenant_id;
  const shortId = session.id.slice(0, 12);

  function handleExit() {
    modals.openConfirmModal({
      title: 'End impersonation session?',
      children: (
        <Text size="sm">
          This will end the impersonation session in <strong>{tenantName}</strong> and return you to
          the super-admin area. The session exit will be logged to both audit logs.
        </Text>
      ),
      labels: { confirm: 'Yes, end session', cancel: 'Stay in session' },
      confirmProps: { color: 'orange' },
      onConfirm: () => {
        void (async () => {
          // Real-API mode: hit the daemon DELETE endpoint and let the
          // listImpersonationSessions query refresh so the banner unmounts
          // when the daemon returns the ended state. Then clear the mock
          // store so `getActiveImpersonationId` stops stamping the
          // impersonation header on subsequent requests.
          if (isRealApi()) {
            try {
              await endMutation.mutateAsync({ id: liveSession.id });
            } finally {
              await queryClient.invalidateQueries({
                queryKey: getListImpersonationSessionsQueryKey(),
              });
            }
          }
          await exit();
          void navigate({ to: '/admin' as string });
        })();
      },
    });
  }

  // Determine if ticketRef is a URL
  const isUrl = (ref: string) => {
    try {
      new URL(ref);
      return true;
    } catch {
      return false;
    }
  };

  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 9999,
        width: '100%',
      }}
    >
      <Alert
        color="yellow"
        variant="filled"
        icon={<IconEye size={16} />}
        py={8}
        px="md"
        radius={0}
        styles={{
          root: { borderRadius: 0 },
          wrapper: { alignItems: 'center' },
          body: { flex: 1 },
          message: { marginTop: 0 },
        }}
      >
        <Group justify="space-between" wrap="nowrap" gap="sm">
          <Group gap="xs" wrap="wrap">
            <Text size="sm" fw={600} c="dark">
              Acting as super-admin in{' '}
              <Text component="span" fw={700}>
                {tenantName}
              </Text>
            </Text>
            <Text size="sm" c="dark.8">
              · reason: {session.reason}
            </Text>
            {session.ticketRef && (
              <Text size="sm" c="dark.8">
                ·{' '}
                {isUrl(session.ticketRef) ? (
                  <Anchor
                    href={session.ticketRef}
                    target="_blank"
                    rel="noopener noreferrer"
                    c="dark.8"
                    fw={600}
                  >
                    {session.ticketRef}
                  </Anchor>
                ) : (
                  <Text component="span" fw={600} c="dark.8">
                    {session.ticketRef}
                  </Text>
                )}
              </Text>
            )}
            <Badge color="dark" variant="filled" size="sm">
              session {shortId}
            </Badge>
          </Group>

          <Button
            size="xs"
            color="dark"
            variant="filled"
            onClick={handleExit}
            styles={{ root: { flexShrink: 0 } }}
            loading={endMutation.isPending}
          >
            End session
          </Button>
        </Group>
      </Alert>
      <ImpersonationIdleModal />
    </div>
  );
}
