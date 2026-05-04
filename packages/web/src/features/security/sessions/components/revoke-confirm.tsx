/**
 * <RevokeAllConfirm> — confirmation modal for revoke-all-other-sessions.
 */
import { useState } from 'react';
import { Modal, Stack, Text, Button, Group, Alert } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import { revokeAllOtherSessions } from '../api';

interface RevokeAllConfirmProps {
  opened: boolean;
  onClose: () => void;
  currentSessionId: string;
}

export function RevokeAllConfirm({ opened, onClose, currentSessionId }: RevokeAllConfirmProps) {
  const [loading, setLoading] = useState(false);

  async function handleConfirm() {
    setLoading(true);
    try {
      const count = await revokeAllOtherSessions(currentSessionId);
      notify.success(
        'Sessions revoked',
        `${String(count)} session${count !== 1 ? 's' : ''} revoked. You remain logged in.`,
      );
      onClose();
    } catch {
      notify.error('Failed to revoke sessions', 'Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title="Revoke all other sessions" size="sm">
      <Stack gap="md">
        <Alert icon={<IconAlertCircle size={16} />} color="orange" variant="light">
          All other active sessions will be signed out immediately. Your current session will remain
          active.
        </Alert>
        <Text size="sm">
          This is useful if you think your account has been accessed from an unknown device or
          location.
        </Text>
        <Group justify="flex-end" gap="sm">
          <Button variant="default" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button color="red.8" size="sm" loading={loading} onClick={() => void handleConfirm()}>
            Revoke all other sessions
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
