/**
 * <ImpersonationIdleModal> — surfaces a 60-second countdown when the
 * active impersonation session is about to expire. Two outcomes:
 *
 *   - User clicks "Extend session" → POST /touch and the modal closes.
 *   - User dismisses or lets the timer reach zero → the modal reflects
 *     the expired state. The actual session teardown is owned by the
 *     daemon (real mode) or `useImpersonation` wall-clock interval
 *     (mock mode); the modal is purely informational at that point.
 *
 * The modal is always mounted at the layout level (next to the banner)
 * but renders nothing when no warning is in flight.
 *
 * spec §8.2 / Task 1d.77
 */
import { Modal, Stack, Text, Group, Button, Badge } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { useImpersonationIdleTimer } from '../use-impersonation-idle-timer';

export interface ImpersonationIdleModalProps {
  /** Override warning threshold (seconds). Defaults to 60. */
  warningThresholdSec?: number;
}

export function ImpersonationIdleModal({ warningThresholdSec }: ImpersonationIdleModalProps = {}) {
  const { warning, secondsRemaining, expired, extend, extending } = useImpersonationIdleTimer(
    warningThresholdSec !== undefined ? { warningThresholdSec } : {},
  );

  const open = warning;
  const display = Math.max(0, secondsRemaining);

  function handleExtend() {
    void extend();
  }

  return (
    <Modal
      opened={open}
      onClose={() => undefined}
      withCloseButton={false}
      centered
      title={
        <Group gap="xs">
          <IconAlertTriangle size={18} color="var(--mantine-color-orange-5)" />
          <Text fw={600}>Impersonation session expiring</Text>
        </Group>
      }
    >
      <Stack gap="md">
        {expired ? (
          <Text size="sm">
            This impersonation session has expired. Any further actions in this tenant will return
            to your normal super-admin context.
          </Text>
        ) : (
          <>
            <Group gap="xs" wrap="nowrap">
              <Text size="sm">Your impersonation session will expire in</Text>
              <Badge color="orange" variant="filled">
                {display}s
              </Badge>
            </Group>
            <Text size="sm">
              Extend the session to continue acting as super-admin in this tenant, or let it expire
              to return to your normal context.
            </Text>
            <Text size="xs" c="dimmed">
              Extending records a touch event on the super-admin audit log.
            </Text>
          </>
        )}

        <Group justify="flex-end">
          {!expired && (
            <Button color="orange" onClick={handleExtend} loading={extending}>
              Extend session
            </Button>
          )}
        </Group>
      </Stack>
    </Modal>
  );
}
