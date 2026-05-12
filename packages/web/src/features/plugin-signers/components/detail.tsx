/**
 * <SignerDetail> — drawer content for a single plugin signer.
 *
 * Sections:
 *   - Header: name, status badge, scope chip, Verify / Revoke buttons
 *   - Fingerprint (full, monospace, copyable)
 *   - Description
 *   - Plugins signed by this signer (nested list)
 *   - Recent audit activity (last 10 entries scoped to this signer)
 *   - Delete (typed-name confirm) — guarded by `plugin-signer:delete`
 *
 * Permission gates:
 *   - Verify / Revoke require `plugin-signer:write`
 *   - Delete requires `plugin-signer:delete` AND the signer must not be
 *     referenced by any plugin (SignerInUseError surfaced in a toast).
 */
import { useMemo, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  CopyButton,
  Divider,
  Group,
  Modal,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconAlertCircle,
  IconCheck,
  IconCircleCheck,
  IconCircleX,
  IconClock,
  IconCopy,
  IconShieldCheck,
  IconShieldLock,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import { useAuditList } from '@/features/audit/api';
import type { AuditFilter } from '@/features/audit/types';
import { notify } from '@/hooks/use-notify';
import { usePermission } from '@/hooks/use-permission';
import {
  deleteSigner,
  revokeSigner,
  useSignerDetail,
  useSignerPlugins,
  verifySigner,
} from '../api';
import { SignerInUseError } from '../types';
import type { PluginSigner } from '../types';

const SIGNER_AUDIT_FILTER: AuditFilter = {
  actions: [],
  outcomes: [],
  resource_types: ['plugin-signer'],
  tiers: [],
  date_from: null,
  date_to: null,
  actor_handles: [],
  resource_id_handles: [],
  search: '',
};

interface SignerDetailProps {
  /**
   * Tenant slug used to scope audit queries. Pass an empty string for
   * the global super-admin view; the audit feed is then empty until
   * cross-tenant audit access lands.
   */
  tenantId: string;
  signerId: string;
  onClose: () => void;
  onEdit?: () => void;
}

const STATUS_CONFIG: Record<
  PluginSigner['status'],
  { color: string; Icon: typeof IconCircleCheck; label: string }
> = {
  verified: { color: 'green', Icon: IconCircleCheck, label: 'verified' },
  revoked: { color: 'red', Icon: IconCircleX, label: 'revoked' },
  pending: { color: 'gray', Icon: IconClock, label: 'pending' },
};

export function SignerDetail({ tenantId, signerId, onClose, onEdit }: SignerDetailProps) {
  const signer = useSignerDetail(signerId);
  const plugins = useSignerPlugins(signerId);
  const auditEntries = useAuditList(tenantId, SIGNER_AUDIT_FILTER);
  const canWrite = usePermission('plugin-signer:write');
  const canDelete = usePermission('plugin-signer:delete');

  const [verifying, setVerifying] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleteOpened, { open: openDelete, close: closeDelete }] = useDisclosure(false);

  const auditTail = useMemo(() => {
    if (!signer) return [];
    return auditEntries
      .filter((e) => e.resource_type === 'plugin-signer' && e.resource_id === signer.id)
      .slice()
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 10);
  }, [auditEntries, signer]);

  if (!signer) {
    return (
      <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
        Signer not found.
      </Alert>
    );
  }

  const status = STATUS_CONFIG[signer.status];
  const deleteBlocked = plugins.length > 0;

  async function handleVerify() {
    if (!signer || signer.status === 'verified') return;
    setVerifying(true);
    try {
      await verifySigner(signer.id);
      notify.success('Signer verified', `${signer.name} is now trusted.`);
    } catch {
      notify.error('Failed to verify signer', 'Please try again.');
    } finally {
      setVerifying(false);
    }
  }

  async function handleRevoke() {
    if (!signer || signer.status === 'revoked') return;
    setRevoking(true);
    try {
      await revokeSigner(signer.id);
      notify.info(
        'Signer revoked',
        `${signer.name} is no longer trusted. Existing plugins keep their historic signer.`,
      );
    } catch {
      notify.error('Failed to revoke signer', 'Please try again.');
    } finally {
      setRevoking(false);
    }
  }

  async function handleDelete() {
    if (!signer) return;
    if (deleteInput !== signer.name) return;
    setDeleting(true);
    try {
      await deleteSigner(signer.id);
      notify.success('Signer deleted', `${signer.name} was removed.`);
      closeDelete();
      onClose();
    } catch (err) {
      if (err instanceof SignerInUseError) {
        notify.error(
          'Cannot delete — in use',
          `${String(err.pluginIds.length)} plugin(s) reference this signer.`,
        );
      } else {
        notify.error('Failed to delete signer', 'Please try again.');
      }
    } finally {
      setDeleting(false);
      setDeleteInput('');
    }
  }

  return (
    <Stack gap="md">
      {/* Header */}
      <Group justify="space-between" align="flex-start">
        <Group gap="sm" wrap="nowrap">
          <IconShieldLock size={28} color="var(--mantine-color-violet-6)" />
          <Stack gap={2}>
            <Group gap="xs" wrap="wrap">
              <Text size="lg" fw={600}>
                {signer.name}
              </Text>
              <Badge
                color={status.color}
                variant="light"
                size="sm"
                leftSection={<status.Icon size={10} />}
              >
                {status.label}
              </Badge>
              {signer.tenant_scope === null ? (
                <Badge color="indigo" variant="light" size="sm">
                  Global
                </Badge>
              ) : (
                <Badge color="gray" variant="outline" size="sm" ff="monospace">
                  {signer.tenant_scope}
                </Badge>
              )}
            </Group>
            <Text size="xs" c="var(--mantine-color-gray-7)">
              Created {dayjs(signer.created_at).format('MMM D, YYYY')}
            </Text>
          </Stack>
        </Group>
      </Group>

      {/* Fingerprint */}
      <Stack gap={4}>
        <Text size="sm" fw={600}>
          Fingerprint (SHA-256)
        </Text>
        <Group gap="xs" wrap="nowrap">
          <Text
            size="xs"
            ff="monospace"
            style={{ wordBreak: 'break-all', userSelect: 'all', flex: 1 }}
          >
            {signer.fingerprint}
          </Text>
          <CopyButton value={signer.fingerprint} timeout={2000}>
            {({ copied, copy }) => (
              <Tooltip label={copied ? 'Copied' : 'Copy fingerprint'}>
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  color={copied ? 'teal' : 'gray'}
                  onClick={copy}
                  aria-label="Copy fingerprint"
                >
                  {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                </ActionIcon>
              </Tooltip>
            )}
          </CopyButton>
        </Group>
      </Stack>

      {/* Description */}
      {signer.description && (
        <Stack gap={4}>
          <Text size="sm" fw={600}>
            Description
          </Text>
          <Text size="sm" c="var(--mantine-color-gray-8)">
            {signer.description}
          </Text>
        </Stack>
      )}

      <Divider />

      {/* Actions */}
      <Group gap="sm">
        {onEdit && (
          <Button size="sm" variant="light" onClick={onEdit}>
            Edit
          </Button>
        )}
        <Tooltip disabled={canWrite} label="Requires plugin-signer:write permission">
          <Button
            size="sm"
            color="green"
            variant="light"
            leftSection={<IconShieldCheck size={14} />}
            loading={verifying}
            disabled={!canWrite || signer.status === 'verified'}
            onClick={() => void handleVerify()}
          >
            Verify
          </Button>
        </Tooltip>
        <Tooltip disabled={canWrite} label="Requires plugin-signer:write permission">
          <Button
            size="sm"
            color="orange"
            variant="light"
            leftSection={<IconShieldLock size={14} />}
            loading={revoking}
            disabled={!canWrite || signer.status === 'revoked'}
            onClick={() => void handleRevoke()}
          >
            Revoke
          </Button>
        </Tooltip>
        <Tooltip
          disabled={canDelete && !deleteBlocked}
          label={
            !canDelete
              ? 'Requires plugin-signer:delete permission'
              : 'Reassign signed plugins before deleting'
          }
        >
          <Button
            size="sm"
            color="red.8"
            variant="subtle"
            disabled={!canDelete || deleteBlocked}
            onClick={openDelete}
          >
            Delete…
          </Button>
        </Tooltip>
      </Group>

      <Divider />

      {/* Plugins using this signer */}
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          Plugins signed by this signer ({String(plugins.length)})
        </Text>
        {plugins.length === 0 ? (
          <Text size="xs" c="var(--mantine-color-gray-7)">
            No installed plugins reference this signer yet.
          </Text>
        ) : (
          <Group gap={6}>
            {plugins.map((p) => (
              <Badge key={p.id} size="sm" variant="light" color="blue">
                {p.display_name} · v{p.version}
              </Badge>
            ))}
          </Group>
        )}
      </Stack>

      <Divider />

      {/* Audit tail */}
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          Recent activity
        </Text>
        {auditTail.length === 0 ? (
          <Text size="xs" c="var(--mantine-color-gray-7)">
            No audit entries for this signer yet.
          </Text>
        ) : (
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Action</Table.Th>
                <Table.Th>Actor</Table.Th>
                <Table.Th>When</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {auditTail.map((e) => (
                <Table.Tr key={e.id}>
                  <Table.Td>
                    <Text size="xs" ff="monospace">
                      {e.action}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">{e.actor_id}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">{dayjs(e.at).format('MMM D, HH:mm:ss')}</Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Stack>

      {/* Delete confirmation modal */}
      <Modal
        opened={deleteOpened}
        onClose={() => {
          closeDelete();
          setDeleteInput('');
        }}
        title="Delete signer"
        size="sm"
      >
        <Stack gap="md">
          <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
            This permanently deletes the signer allow-list entry. Plugins still referencing it must
            be reassigned first.
          </Alert>
          <Text size="sm">
            Type{' '}
            <Text component="span" fw={600} ff="monospace">
              {signer.name}
            </Text>{' '}
            to confirm.
          </Text>
          <TextInput
            value={deleteInput}
            onChange={(e) => {
              setDeleteInput(e.currentTarget.value);
            }}
            placeholder={signer.name}
            data-autofocus
          />
          <Group justify="flex-end" gap="sm">
            <Button
              variant="default"
              size="sm"
              onClick={() => {
                closeDelete();
                setDeleteInput('');
              }}
            >
              Cancel
            </Button>
            <Button
              color="red.8"
              size="sm"
              loading={deleting}
              disabled={deleteInput !== signer.name}
              onClick={() => void handleDelete()}
            >
              Delete permanently
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
