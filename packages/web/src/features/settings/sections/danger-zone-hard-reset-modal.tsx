/**
 * <HardResetModal> — triple-confirm modal for hard-resetting tenant data.
 *
 * Stage-1 note: the hard reset resets the ENTIRE mock store (all tenants),
 * not just the current tenant. A banner in the modal communicates this
 * limitation; a true per-tenant reset is deferred to stage 2.
 *
 * Triple-confirm requirements:
 *   1. Type the tenant slug exactly
 *   2. Type "RESET" in caps
 *   3. Checkbox: "I understand this action cannot be undone"
 *
 * Task 8c.13
 */
import { useState } from 'react';
import { Alert, Button, Checkbox, Group, Modal, Stack, Text, TextInput } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import { hardResetTenant } from '../api';

// ─── Props ────────────────────────────────────────────────────────────────────

interface HardResetModalProps {
  opened: boolean;
  onClose: () => void;
  tenantId: string;
  tenantSlug: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function HardResetModal({ opened, onClose, tenantId, tenantSlug }: HardResetModalProps) {
  const [slugValue, setSlugValue] = useState('');
  const [resetValue, setResetValue] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);

  const allConfirmed = slugValue === tenantSlug && resetValue === 'RESET' && confirmed;

  function handleClose() {
    setSlugValue('');
    setResetValue('');
    setConfirmed(false);
    onClose();
  }

  async function handleSubmit() {
    if (!allConfirmed) return;
    setLoading(true);
    try {
      await hardResetTenant(tenantId);
      notify.warn('Tenant data reset to seed defaults');
      handleClose();
    } catch (e) {
      notify.error('Reset failed', (e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // duration=0 prevents JSDOM animation hangs in tests
  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title="Hard reset tenant data"
      size="md"
      data-testid="hard-reset-modal"
      transitionProps={{ duration: 0 }}
    >
      <Stack gap="sm">
        {/* Stage-1 limitation banner */}
        <Alert
          icon={<IconAlertTriangle size={16} />}
          color="orange"
          data-testid="hard-reset-stage1-warning"
        >
          <Text size="sm" fw={500}>
            Stage-1 limitation
          </Text>
          <Text size="sm">
            In this mock stage, the hard reset resets ALL tenant data in the store, not just this
            tenant. Per-tenant scoped reset will be available at stage 2.
          </Text>
        </Alert>

        <Text size="sm">
          This will reset all data for <strong>{tenantSlug}</strong> back to seed defaults. This
          cannot be undone.
        </Text>

        <TextInput
          label={`Type the tenant slug to confirm: "${tenantSlug}"`}
          placeholder={tenantSlug}
          value={slugValue}
          onChange={(e) => {
            setSlugValue(e.currentTarget.value);
          }}
          data-testid="hard-reset-slug-input"
        />

        <TextInput
          label='Type "RESET" to confirm'
          placeholder="RESET"
          value={resetValue}
          onChange={(e) => {
            setResetValue(e.currentTarget.value);
          }}
          data-testid="hard-reset-word-input"
        />

        <Checkbox
          label="I understand this action cannot be undone"
          checked={confirmed}
          onChange={(e) => {
            setConfirmed(e.currentTarget.checked);
          }}
          data-testid="hard-reset-confirm-checkbox"
        />

        <Group justify="flex-end" mt="sm">
          <Button variant="default" onClick={handleClose} data-testid="hard-reset-cancel-button">
            Cancel
          </Button>
          <Button
            color="red"
            disabled={!allConfirmed}
            loading={loading}
            onClick={() => {
              void handleSubmit();
            }}
            data-testid="hard-reset-submit-button"
          >
            Reset tenant data
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
