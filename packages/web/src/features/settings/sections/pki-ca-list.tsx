/**
 * <PkiCaList> — Certificate Authority list for the PKI settings section.
 *
 * Shows internal + external CAs for the current tenant.
 * Task 8b.7
 */
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Code,
  Drawer,
  Group,
  Modal,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { IconAlertTriangle, IconLock, IconPlus, IconTrash } from '@tabler/icons-react';
import type { CertAuthority } from '@/api/resources/types';
import { notify } from '@/hooks/use-notify';
import { useCertAuthorities, revokeCertAuthority, deleteCertAuthority } from '../api';
import { CreateCaModal } from './pki-create-ca-modal';

// ─── Props ────────────────────────────────────────────────────────────────────

interface PkiCaListProps {
  tenantId: string;
  canWrite: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

// ─── CA detail drawer ─────────────────────────────────────────────────────────

interface CaDetailDrawerProps {
  ca: CertAuthority | null;
  onClose: () => void;
}

function CaDetailDrawer({ ca, onClose }: CaDetailDrawerProps) {
  const [confirming, setConfirming] = useState<'revoke' | 'delete' | null>(null);
  if (!ca) return null;

  return (
    <Drawer
      opened
      onClose={onClose}
      title={
        <Group gap="xs">
          <Text fw={600}>{ca.name}</Text>
          {ca.revoked && (
            <Badge size="sm" color="red" variant="light">
              Revoked
            </Badge>
          )}
        </Group>
      }
      position="right"
      size="min(400px, 95vw)"
      data-testid="ca-detail-drawer"
    >
      <Stack gap="md">
        <Stack gap={4}>
          <Text size="sm" fw={500}>
            Kind
          </Text>
          <Badge color={ca.kind === 'internal' ? 'green' : 'blue'} variant="light">
            {ca.kind}
          </Badge>
        </Stack>

        <Stack gap={4}>
          <Text size="sm" fw={500}>
            Subject
          </Text>
          <Text size="sm" c="var(--mantine-color-gray-7)">
            {ca.subject}
          </Text>
        </Stack>

        <Stack gap={4}>
          <Text size="sm" fw={500}>
            Issuer
          </Text>
          <Text size="sm" c="var(--mantine-color-gray-7)">
            {ca.issuer}
          </Text>
        </Stack>

        <Stack gap={4}>
          <Text size="sm" fw={500}>
            Valid from
          </Text>
          <Text size="sm" c="var(--mantine-color-gray-7)">
            {formatDate(ca.not_before)}
          </Text>
        </Stack>

        <Stack gap={4}>
          <Text size="sm" fw={500}>
            Valid until
          </Text>
          <Text size="sm" c="var(--mantine-color-gray-7)">
            {formatDate(ca.not_after)}
          </Text>
        </Stack>

        <Stack gap={4}>
          <Text size="sm" fw={500}>
            SHA-256 fingerprint
          </Text>
          <Text
            size="xs"
            ff="monospace"
            c="var(--mantine-color-gray-7)"
            style={{ wordBreak: 'break-all' }}
          >
            {ca.fingerprint_sha256}
          </Text>
        </Stack>

        {ca.certificate_pem.length > 0 && (
          <Stack gap={4}>
            <Text size="sm" fw={500}>
              Certificate PEM
            </Text>
            <Code block style={{ maxHeight: 300, overflow: 'auto', fontSize: 12 }}>
              {ca.certificate_pem}
            </Code>
          </Stack>
        )}

        {ca.revoked ? (
          <Stack gap="xs">
            <Alert
              color="red"
              variant="light"
              icon={<IconAlertTriangle size={16} />}
              title="Revoked"
            >
              <Text size="sm">
                Revoked {ca.revoked_at ? new Date(ca.revoked_at).toLocaleString() : ''}.
              </Text>
              {ca.revocation_reason && (
                <Text size="xs" c="var(--mantine-color-gray-7)" mt={4}>
                  Reason: {ca.revocation_reason}
                </Text>
              )}
            </Alert>
            <Button
              size="sm"
              color="red"
              variant="filled"
              leftSection={<IconTrash size={14} />}
              onClick={() => {
                setConfirming('delete');
              }}
              data-testid="ca-delete-button"
            >
              Permanently delete
            </Button>
          </Stack>
        ) : (
          <Button
            variant="light"
            color="red.8"
            size="sm"
            onClick={() => {
              setConfirming('revoke');
            }}
            data-testid="ca-revoke-button"
          >
            Revoke
          </Button>
        )}
      </Stack>

      {confirming === 'revoke' && (
        <RevokeCaModal
          ca={ca}
          onClose={() => {
            setConfirming(null);
          }}
        />
      )}
      {confirming === 'delete' && (
        <DeleteCaModal
          ca={ca}
          onClose={() => {
            setConfirming(null);
          }}
          onDeleted={() => {
            setConfirming(null);
            onClose();
          }}
        />
      )}
    </Drawer>
  );
}

// ─── Revoke modal ─────────────────────────────────────────────────────────────

interface RevokeCaModalProps {
  ca: CertAuthority;
  onClose: () => void;
}

function RevokeCaModal({ ca, onClose }: RevokeCaModalProps) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleRevoke() {
    setBusy(true);
    try {
      await revokeCertAuthority(ca.id, reason.trim());
      notify.success('CA revoked', `${ca.name} has been revoked.`);
      onClose();
    } catch (e) {
      notify.error('Revoke failed', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      opened
      onClose={onClose}
      title="Revoke certificate authority?"
      size="sm"
      transitionProps={{ duration: 0 }}
    >
      <Stack gap="md">
        <Alert color="orange" variant="light" icon={<IconAlertTriangle size={16} />}>
          New enrollments under this CA will be blocked. Already-issued certificates remain valid
          until they expire.
        </Alert>
        <Textarea
          label="Reason (optional)"
          placeholder="e.g. Key compromise, scheduled rotation"
          minRows={2}
          autosize
          maxRows={4}
          value={reason}
          onChange={(e) => {
            setReason(e.currentTarget.value);
          }}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            color="red"
            loading={busy}
            onClick={() => {
              void handleRevoke();
            }}
            data-testid="ca-revoke-confirm"
          >
            Revoke CA
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ─── Delete modal (typed-name confirmation) ──────────────────────────────────

interface DeleteCaModalProps {
  ca: CertAuthority;
  onClose: () => void;
  onDeleted: () => void;
}

function DeleteCaModal({ ca, onClose, onDeleted }: DeleteCaModalProps) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const matches = typed === ca.name;

  async function handleDelete() {
    if (!matches) return;
    setBusy(true);
    try {
      await deleteCertAuthority(ca.id);
      notify.success('CA deleted', `${ca.name} was permanently removed.`);
      onDeleted();
    } catch (e) {
      notify.error('Delete failed', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      opened
      onClose={onClose}
      title="Permanently delete CA?"
      size="sm"
      transitionProps={{ duration: 0 }}
    >
      <Stack gap="md">
        <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
          This permanently removes the CA record. Issued certificates may still be honored by third
          parties — operators are responsible for distributing CRLs / OCSP info externally.
        </Alert>
        <Text size="sm">
          Type the CA name to confirm:{' '}
          <Text component="span" fw={600} ff="monospace">
            {ca.name}
          </Text>
        </Text>
        <TextInput
          value={typed}
          onChange={(e) => {
            setTyped(e.currentTarget.value);
          }}
          placeholder={ca.name}
          data-autofocus
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            color="red"
            loading={busy}
            disabled={!matches}
            onClick={() => {
              void handleDelete();
            }}
            data-testid="ca-delete-confirm"
          >
            Delete permanently
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PkiCaList({ tenantId, canWrite }: PkiCaListProps) {
  const cas = useCertAuthorities();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedCa, setSelectedCa] = useState<CertAuthority | null>(null);

  return (
    <>
      <Stack gap="sm" data-testid="pki-ca-list">
        <Group justify="space-between" align="center">
          <Title order={5}>Certificate Authorities</Title>
          <Tooltip label="Requires pki:write permission" disabled={canWrite}>
            <span>
              <Button
                size="sm"
                leftSection={!canWrite ? <IconLock size={14} /> : <IconPlus size={14} />}
                disabled={!canWrite}
                onClick={() => {
                  setCreateOpen(true);
                }}
                data-testid="create-ca-button"
              >
                Create new CA
              </Button>
            </span>
          </Tooltip>
        </Group>

        {cas.length === 0 ? (
          <Text size="sm" c="var(--mantine-color-gray-7)" data-testid="ca-empty-state">
            No certificate authorities configured.
          </Text>
        ) : (
          <Table striped highlightOnHover data-testid="ca-table">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Kind</Table.Th>
                <Table.Th>Subject</Table.Th>
                <Table.Th>Expires</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {cas.map((ca) => (
                <Table.Tr
                  key={ca.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    setSelectedCa(ca);
                  }}
                  data-testid={`ca-row-${ca.id}`}
                >
                  <Table.Td>{ca.name}</Table.Td>
                  <Table.Td>
                    <Badge
                      color={ca.kind === 'internal' ? 'green' : 'blue'}
                      variant="light"
                      size="sm"
                      data-testid={`ca-kind-badge-${ca.id}`}
                    >
                      {ca.kind}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" lineClamp={1}>
                      {ca.subject}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{formatDate(ca.not_after)}</Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Stack>

      <CreateCaModal
        opened={createOpen}
        onClose={() => {
          setCreateOpen(false);
        }}
        tenantId={tenantId}
        canWrite={canWrite}
      />

      <CaDetailDrawer
        ca={selectedCa}
        onClose={() => {
          setSelectedCa(null);
        }}
      />
    </>
  );
}
