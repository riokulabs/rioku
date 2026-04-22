/**
 * <DeleteSiteModal> — typed-domain delete confirm Modal, shared between
 * <SiteDetail> and the list-row action handler on the sites route.
 *
 * Requires the user to type the site's `domain` into a TextInput before the
 * destructive "Delete permanently" button activates. On success fires
 * `onSuccess` (which callers use to close drawers / refresh state) and
 * `onClose` (for plain dismissal). Handles its own loading state and input
 * reset on close.
 */
import { useState } from 'react';
import { Alert, Button, Group, Modal, Stack, Text, TextInput } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import { deleteSite } from '../api';
import type { Site } from '@/api/resources/types';

export interface DeleteSiteModalProps {
  opened: boolean;
  /** Site to delete. `null` when the modal is closed. */
  site: Site | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function DeleteSiteModal({ opened, site, onClose, onSuccess }: DeleteSiteModalProps) {
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!site) return;
    if (typed !== site.domain) return;
    setDeleting(true);
    try {
      await deleteSite(site.id, typed);
      notify.success('Site deleted', `${site.domain} was removed.`);
      onSuccess();
    } catch {
      notify.error('Failed to delete site', 'Please try again.');
    } finally {
      setDeleting(false);
      setTyped('');
    }
  }

  const domain = site?.domain ?? '';

  return (
    <Modal
      opened={opened}
      onClose={() => {
        onClose();
        setTyped('');
      }}
      title="Delete site"
      size="sm"
    >
      <Stack gap="md">
        <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
          This permanently deletes the site. Traffic to this domain will stop being served.
        </Alert>
        <Text size="sm">
          Type{' '}
          <Text component="span" fw={600} ff="monospace">
            {domain}
          </Text>{' '}
          to confirm.
        </Text>
        <TextInput
          value={typed}
          onChange={(e) => {
            setTyped(e.currentTarget.value);
          }}
          placeholder={domain}
          data-autofocus
          aria-label="Confirm site domain"
        />
        <Group justify="flex-end" gap="sm">
          <Button
            variant="default"
            size="sm"
            onClick={() => {
              onClose();
              setTyped('');
            }}
          >
            Cancel
          </Button>
          <Button
            color="red"
            size="sm"
            loading={deleting}
            disabled={!site || typed !== domain}
            onClick={() => void handleDelete()}
          >
            Delete permanently
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
