import { Modal, Button, Text, Group, Code, Stack } from '@mantine/core';

export interface DestructiveConfirmProps {
  open: boolean;
  method: string;
  path: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DestructiveConfirmModal({
  open,
  method,
  path,
  onCancel,
  onConfirm,
}: DestructiveConfirmProps) {
  return (
    <Modal opened={open} onClose={onCancel} title="Confirm destructive request" size="md" centered>
      <Stack gap="md">
        <Text>
          You are about to send a <strong>{method}</strong> request to live data. This action will
          mutate or delete state and cannot be undone from the API Explorer.
        </Text>
        <Code block>{`${method} ${path}`}</Code>
        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel}>
            Cancel
          </Button>
          <Button color="red" onClick={onConfirm}>
            Send anyway
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
