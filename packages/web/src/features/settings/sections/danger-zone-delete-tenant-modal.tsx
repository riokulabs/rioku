/**
 * <DeleteTenantModal> — triple-confirm modal for deleting a tenant.
 *
 * Super-admin only. Triple-confirm requirements:
 *   1. Type the tenant slug exactly
 *   2. Type "DELETE" in caps
 *   3. Checkbox: "I understand this is irreversible"
 *
 * On submit, caller is responsible for navigating away (the tenant no longer
 * exists after deletion).
 *
 * Task 8c.13
 */
import { useState } from 'react';
import {
  Button,
  Checkbox,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { notify } from '@/hooks/use-notify';
import { deleteTenant } from '../api';

// ─── Props ────────────────────────────────────────────────────────────────────

interface DeleteTenantModalProps {
  opened: boolean;
  onClose: () => void;
  tenantId: string;
  tenantSlug: string;
  onDeleted: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DeleteTenantModal({ opened, onClose, tenantId, tenantSlug, onDeleted }: DeleteTenantModalProps) {
  const [slugValue, setSlugValue] = useState('');
  const [deleteValue, setDeleteValue] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);

  const allConfirmed =
    slugValue === tenantSlug &&
    deleteValue === 'DELETE' &&
    confirmed;

  function handleClose() {
    setSlugValue('');
    setDeleteValue('');
    setConfirmed(false);
    onClose();
  }

  async function handleSubmit() {
    if (!allConfirmed) return;
    setLoading(true);
    try {
      await deleteTenant(tenantId);
      notify.warn(`Tenant "${tenantSlug}" has been deleted`);
      handleClose();
      onDeleted();
    } catch (e) {
      notify.error('Delete failed', (e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // duration=0 prevents JSDOM animation hangs in tests
  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title="Delete tenant"
      size="md"
      data-testid="delete-tenant-modal"
      transitionProps={{ duration: 0 }}
    >
      <Stack gap="sm">
        <Text size="sm">
          This will permanently delete <strong>{tenantSlug}</strong> and all
          associated resources. This action cannot be undone.
        </Text>

        <TextInput
          label={`Type the tenant slug to confirm: "${tenantSlug}"`}
          placeholder={tenantSlug}
          value={slugValue}
          onChange={(e) => { setSlugValue(e.currentTarget.value); }}
          data-testid="delete-tenant-slug-input"
        />

        <TextInput
          label='Type "DELETE" to confirm'
          placeholder="DELETE"
          value={deleteValue}
          onChange={(e) => { setDeleteValue(e.currentTarget.value); }}
          data-testid="delete-tenant-word-input"
        />

        <Checkbox
          label="I understand this is irreversible"
          checked={confirmed}
          onChange={(e) => { setConfirmed(e.currentTarget.checked); }}
          data-testid="delete-tenant-confirm-checkbox"
        />

        <Group justify="flex-end" mt="sm">
          <Button variant="default" onClick={handleClose} data-testid="delete-tenant-cancel-button">
            Cancel
          </Button>
          <Button
            color="red"
            disabled={!allConfirmed}
            loading={loading}
            onClick={() => { void handleSubmit(); }}
            data-testid="delete-tenant-submit-button"
          >
            Delete tenant
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
