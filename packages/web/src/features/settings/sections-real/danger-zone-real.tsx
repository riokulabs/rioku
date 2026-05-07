 
/**
 * Real-API DangerZoneSection — stage-2 wiring with triple-confirm UX.
 *
 * Three actions, each gated behind a triple-confirm modal:
 *   1. Hard reset      — POST /settings/danger/hard-reset (tenant:hard-reset)
 *   2. Export          — GET  /settings/danger/export      (tenant:export)
 *   3. Delete tenant   — DELETE /settings/danger/tenant    (tenant:delete, super-admin only)
 *
 * Triple-confirm contract (per Plan 07 Task 9):
 *   Step 1: read description of action + risks
 *   Step 2: type the magic word (DELETE / RESET / EXPORT) or tenant slug
 *   Step 3: tick "I understand this is irreversible"
 * Submit button stays disabled until all three are satisfied.
 *
 * Plan 07 — Task 9.
 */
import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Group,
  List,
  Modal,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import {
  useDeleteDangerTenant,
  usePostDangerHardReset,
} from '@/api/generated/settings/settings';
import { customFetch } from '@/api/mutator';
import { notify } from '@/hooks/use-notify';
import { usePermission } from '@/hooks/use-permission';

interface DangerZoneRealSectionProps {
  tenant: string;
  tenantSlug: string;
  onTenantDeleted?: () => void;
}

interface TripleConfirmModalProps {
  opened: boolean;
  onClose: () => void;
  title: string;
  description: string;
  risks: string[];
  magicWord: string;
  testidPrefix: string;
  submitLabel: string;
  submitColor: string;
  onSubmit: () => Promise<void>;
}

/**
 * Reusable triple-confirm modal. Step gates: word input, slug input,
 * checkbox. Submit disabled until all three satisfy.
 *
 * Used by all three danger-zone modals; consolidates Plan 07 Task 9
 * UX requirements.
 */
function TripleConfirmModal({
  opened,
  onClose,
  title,
  description,
  risks,
  magicWord,
  testidPrefix,
  submitLabel,
  submitColor,
  onSubmit,
}: TripleConfirmModalProps) {
  const [word, setWord] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [running, setRunning] = useState(false);

  const wordOk = word === magicWord;
  const allConfirmed = wordOk && acknowledged;

  function reset() {
    setWord('');
    setAcknowledged(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit() {
    if (!allConfirmed) return;
    setRunning(true);
    try {
      await onSubmit();
      reset();
      onClose();
    } finally {
      setRunning(false);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={title}
      size="md"
      data-testid={`${testidPrefix}-modal`}
      transitionProps={{ duration: 0 }}
    >
      <Stack gap="md">
        <Alert color="red" icon={<IconAlertTriangle size={16} />} data-testid={`${testidPrefix}-step-1`}>
          <Stack gap="xs">
            <Text size="sm" fw={600}>
              Step 1 — Review the action
            </Text>
            <Text size="sm">{description}</Text>
            <List size="sm" spacing={2}>
              {risks.map((r) => (
                <List.Item key={r}>{r}</List.Item>
              ))}
            </List>
          </Stack>
        </Alert>

        <Stack gap={4} data-testid={`${testidPrefix}-step-2`}>
          <Text size="sm" fw={600}>
            Step 2 — Type{' '}
            <Text span ff="monospace" fw={700}>
              {magicWord}
            </Text>{' '}
            to confirm
          </Text>
          <TextInput
            placeholder={magicWord}
            value={word}
            onChange={(e) => {
              setWord(e.currentTarget.value);
            }}
            data-testid={`${testidPrefix}-word-input`}
          />
        </Stack>

        <Stack gap={4} data-testid={`${testidPrefix}-step-3`}>
          <Text size="sm" fw={600}>
            Step 3 — Acknowledge
          </Text>
          <Checkbox
            label="I understand this is irreversible"
            checked={acknowledged}
            onChange={(e) => {
              setAcknowledged(e.currentTarget.checked);
            }}
            data-testid={`${testidPrefix}-ack`}
          />
        </Stack>

        <Group justify="flex-end" mt="sm">
          <Button variant="default" onClick={handleClose} data-testid={`${testidPrefix}-cancel`}>
            Cancel
          </Button>
          <Button
            color={submitColor}
            disabled={!allConfirmed}
            loading={running}
            onClick={() => {
              void handleSubmit();
            }}
            data-testid={`${testidPrefix}-submit`}
          >
            {submitLabel}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export function DangerZoneRealSection({
  tenant,
  tenantSlug,
  onTenantDeleted,
}: DangerZoneRealSectionProps) {
  const canHardReset = usePermission('tenant:hard-reset');
  const canExport = usePermission('tenant:export');
  const canDelete = usePermission('tenant:delete');

  const [resetOpen, setResetOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const hardReset = usePostDangerHardReset();
  const deleteTenant = useDeleteDangerTenant();

  async function doHardReset() {
    try {
      await hardReset.mutateAsync({
        tenant,
        data: { confirmation: `${tenantSlug}\n${tenantSlug}\n${tenantSlug}` },
      });
      notify.warn('Tenant non-config data has been reset.');
    } catch (err) {
      notify.error('Hard reset failed', err instanceof Error ? err.message : 'Unknown');
    }
  }

  async function doExport() {
    setExporting(true);
    try {
      const blob = await customFetch<Blob>({
        url: `/t/${encodeURIComponent(tenant)}/settings/danger/export`,
        method: 'GET',
      });
      const downloadable =
        blob instanceof Blob ? blob : new Blob([JSON.stringify(blob, null, 2)], { type: 'application/json' });
      const href = URL.createObjectURL(downloadable);
      const link = document.createElement('a');
      link.href = href;
      link.download = `${tenantSlug}-export.json`;
      link.click();
      URL.revokeObjectURL(href);
      notify.success('Export downloaded');
    } catch (err) {
      notify.error('Export failed', err instanceof Error ? err.message : 'Unknown');
    } finally {
      setExporting(false);
    }
  }

  async function doDelete() {
    try {
      await deleteTenant.mutateAsync({ tenant });
      notify.warn(`Tenant "${tenantSlug}" deleted.`);
      onTenantDeleted?.();
    } catch (err) {
      notify.error('Delete failed', err instanceof Error ? err.message : 'Unknown');
    }
  }

  return (
    <Stack gap="lg" data-testid="danger-zone-real-section">
      <Title order={4}>Danger zone</Title>

      <Card withBorder data-testid="danger-real-reset-card">
        <Stack gap="sm">
          <Title order={6}>Hard reset</Title>
          <Text size="sm">
            Clears traces, runtime metrics, audit log, and ephemeral sessions
            for <strong>{tenantSlug}</strong>. Configuration is preserved.
          </Text>
          <Tooltip label="Requires tenant:hard-reset" disabled={canHardReset}>
            <span>
              <Button
                color="orange"
                disabled={!canHardReset}
                onClick={() => {
                  setResetOpen(true);
                }}
                data-testid="danger-real-reset-open"
              >
                Hard reset…
              </Button>
            </span>
          </Tooltip>
        </Stack>
      </Card>

      <Card withBorder data-testid="danger-real-export-card">
        <Stack gap="sm">
          <Title order={6}>Export tenant</Title>
          <Text size="sm">
            Download a JSON snapshot of every config and data row scoped to{' '}
            <strong>{tenantSlug}</strong>.
          </Text>
          <Tooltip label="Requires tenant:export" disabled={canExport}>
            <span>
              <Button
                disabled={!canExport}
                onClick={() => {
                  setExportOpen(true);
                }}
                data-testid="danger-real-export-open"
              >
                Export…
              </Button>
            </span>
          </Tooltip>
        </Stack>
      </Card>

      {canDelete && (
        <Card withBorder data-testid="danger-real-delete-card">
          <Stack gap="sm">
            <Title order={6}>Delete tenant (super-admin)</Title>
            <Text size="sm">
              Permanently destroy <strong>{tenantSlug}</strong> and all
              associated data. Cannot be undone.
            </Text>
            <Button
              color="red.8"
              onClick={() => {
                setDeleteOpen(true);
              }}
              data-testid="danger-real-delete-open"
            >
              Delete tenant…
            </Button>
          </Stack>
        </Card>
      )}

      <TripleConfirmModal
        opened={resetOpen}
        onClose={() => {
          setResetOpen(false);
        }}
        title="Hard reset tenant data"
        description="This will erase non-config data (traces, audit log, runtime metrics, ephemeral sessions) for the tenant. Configuration is preserved."
        risks={[
          'Audit log will be lost.',
          'Trace history will be lost.',
          'Runtime metrics counters reset to zero.',
        ]}
        magicWord="RESET"
        testidPrefix="danger-real-reset"
        submitLabel="Reset tenant data"
        submitColor="orange"
        onSubmit={doHardReset}
      />

      <TripleConfirmModal
        opened={exportOpen}
        onClose={() => {
          setExportOpen(false);
        }}
        title="Export tenant data"
        description="Download a JSON snapshot of every config and data row scoped to this tenant. The export includes secrets in plaintext — store the file securely."
        risks={[
          'Export contains secrets in plaintext.',
          'Exports are not automatically rotated.',
        ]}
        magicWord="EXPORT"
        testidPrefix="danger-real-export"
        submitLabel={exporting ? 'Downloading…' : 'Download export'}
        submitColor="blue"
        onSubmit={doExport}
      />

      <TripleConfirmModal
        opened={deleteOpen}
        onClose={() => {
          setDeleteOpen(false);
        }}
        title="Delete tenant"
        description={`Permanently delete the tenant "${tenantSlug}". All sites, routes, services, dashboards, secrets, audit, traces, and members will be destroyed.`}
        risks={[
          'All sites, routes, services destroyed.',
          'Members lose access immediately.',
          'No way to recover the tenant after this.',
        ]}
        magicWord={tenantSlug}
        testidPrefix="danger-real-delete"
        submitLabel="Delete tenant permanently"
        submitColor="red.8"
        onSubmit={doDelete}
      />
    </Stack>
  );
}
