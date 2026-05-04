/**
 * <PkiEnrollmentList> — Certificate enrollment list for the PKI settings section.
 *
 * Shows pending/issued/revoked enrollments for the current tenant.
 * Task 8b.7
 */
import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Drawer,
  Group,
  Modal,
  SegmentedControl,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { IconLock, IconPlus } from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import type { CertEnrollment } from '@/api/resources/types';
import { useCertAuthorities, useCertEnrollments, revokeCertEnrollment } from '../api';
import { CreateEnrollmentModal } from './pki-create-enrollment-modal';

// ─── Props ────────────────────────────────────────────────────────────────────

interface PkiEnrollmentListProps {
  tenantId: string;
  canWrite: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type StateFilter = 'all' | 'pending' | 'issued' | 'revoked';

const STATE_BADGE_COLOR: Record<CertEnrollment['state'], string> = {
  pending: 'yellow',
  issued: 'green',
  revoked: 'red',
};

function formatDate(iso: string | undefined): string {
  if (!iso) return '—';
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

// ─── Enrollment detail drawer ─────────────────────────────────────────────────

interface EnrollmentDetailDrawerProps {
  enrollment: CertEnrollment | null;
  caName: string;
  canWrite: boolean;
  onClose: () => void;
  onRevoked: () => void;
}

function EnrollmentDetailDrawer({
  enrollment,
  caName,
  canWrite,
  onClose,
  onRevoked,
}: EnrollmentDetailDrawerProps) {
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [revokeReason, setRevokeReason] = useState('');
  const [revoking, setRevoking] = useState(false);

  if (!enrollment) return null;

  async function handleRevoke() {
    if (!enrollment || !canWrite) return;
    setRevoking(true);
    try {
      await revokeCertEnrollment(enrollment.id, revokeReason);
      notify.success('Certificate revoked', `"${enrollment.subject}" has been revoked.`);
      setRevokeOpen(false);
      setRevokeReason('');
      onRevoked();
      onClose();
    } catch (e) {
      notify.error('Revoke failed', (e as Error).message);
    } finally {
      setRevoking(false);
    }
  }

  return (
    <>
      <Drawer
        opened
        onClose={onClose}
        title={enrollment.subject}
        position="right"
        size="min(400px, 95vw)"
        data-testid="enrollment-detail-drawer"
      >
        <Stack gap="md">
          <Stack gap={4}>
            <Text size="sm" fw={500}>
              State
            </Text>
            <Badge color={STATE_BADGE_COLOR[enrollment.state]} variant="light">
              {enrollment.state}
            </Badge>
          </Stack>

          <Stack gap={4}>
            <Text size="sm" fw={500}>
              Certificate Authority
            </Text>
            <Text size="sm" c="var(--mantine-color-gray-7)">
              {caName}
            </Text>
          </Stack>

          <Stack gap={4}>
            <Text size="sm" fw={500}>
              DNS SANs
            </Text>
            <Text size="sm" c="var(--mantine-color-gray-7)">
              {enrollment.dns_sans.length > 0 ? enrollment.dns_sans.join(', ') : '—'}
            </Text>
          </Stack>

          <Stack gap={4}>
            <Text size="sm" fw={500}>
              Requested
            </Text>
            <Text size="sm" c="var(--mantine-color-gray-7)">
              {formatDate(enrollment.requested_at)}
            </Text>
          </Stack>

          {enrollment.issued_at !== undefined && (
            <Stack gap={4}>
              <Text size="sm" fw={500}>
                Issued
              </Text>
              <Text size="sm" c="var(--mantine-color-gray-7)">
                {formatDate(enrollment.issued_at)}
              </Text>
            </Stack>
          )}

          {enrollment.revoked_at !== undefined && (
            <Stack gap={4}>
              <Text size="sm" fw={500}>
                Revoked
              </Text>
              <Text size="sm" c="var(--mantine-color-gray-7)">
                {formatDate(enrollment.revoked_at)}
              </Text>
            </Stack>
          )}

          {enrollment.revocation_reason !== undefined && (
            <Stack gap={4}>
              <Text size="sm" fw={500}>
                Revocation reason
              </Text>
              <Text size="sm" c="var(--mantine-color-gray-7)">
                {enrollment.revocation_reason}
              </Text>
            </Stack>
          )}

          {enrollment.fingerprint_sha256 !== undefined && (
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
                {enrollment.fingerprint_sha256}
              </Text>
            </Stack>
          )}

          {enrollment.state === 'issued' && (
            <Tooltip label="Requires pki:write permission" disabled={canWrite}>
              <span>
                <Button
                  variant="light"
                  color="red.8"
                  size="sm"
                  disabled={!canWrite}
                  leftSection={!canWrite ? <IconLock size={14} /> : undefined}
                  onClick={() => {
                    setRevokeOpen(true);
                  }}
                  data-testid="enrollment-revoke-button"
                >
                  Revoke certificate
                </Button>
              </span>
            </Tooltip>
          )}
        </Stack>
      </Drawer>

      {/* Revoke confirmation modal */}
      {/* duration=0 prevents JSDOM animation hangs in tests */}
      <Modal
        opened={revokeOpen}
        onClose={() => {
          setRevokeOpen(false);
        }}
        title="Revoke certificate"
        size="sm"
        data-testid="revoke-confirm-modal"
        transitionProps={{ duration: 0 }}
      >
        <Stack gap="sm">
          <Text size="sm">
            Are you sure you want to revoke this certificate? This action cannot be undone.
          </Text>
          <TextInput
            label="Reason (optional)"
            placeholder="e.g. Key compromised"
            data-testid="revoke-reason-input"
            value={revokeReason}
            onChange={(e) => {
              setRevokeReason(e.currentTarget.value);
            }}
          />
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => {
                setRevokeOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              color="red.8"
              loading={revoking}
              onClick={() => {
                void handleRevoke();
              }}
              data-testid="revoke-confirm-button"
            >
              Revoke
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PkiEnrollmentList({ tenantId, canWrite }: PkiEnrollmentListProps) {
  const enrollments = useCertEnrollments();
  const cas = useCertAuthorities();
  const [createOpen, setCreateOpen] = useState(false);
  const [filter, setFilter] = useState<StateFilter>('all');
  const [selectedEnrollment, setSelectedEnrollment] = useState<CertEnrollment | null>(null);

  const caMap = useMemo(() => Object.fromEntries(cas.map((ca) => [ca.id, ca.name])), [cas]);

  const filtered = filter === 'all' ? enrollments : enrollments.filter((e) => e.state === filter);

  return (
    <>
      <Stack gap="sm" data-testid="pki-enrollment-list">
        <Group justify="space-between" align="center">
          <Title order={5}>Certificate Enrollments</Title>
          <Tooltip label="Requires pki:write permission" disabled={canWrite}>
            <span>
              <Button
                size="sm"
                leftSection={!canWrite ? <IconLock size={14} /> : <IconPlus size={14} />}
                disabled={!canWrite}
                onClick={() => {
                  setCreateOpen(true);
                }}
                data-testid="request-enrollment-button"
              >
                Request new certificate
              </Button>
            </span>
          </Tooltip>
        </Group>

        <SegmentedControl
          data={[
            { value: 'all', label: 'All' },
            { value: 'pending', label: 'Pending' },
            { value: 'issued', label: 'Issued' },
            { value: 'revoked', label: 'Revoked' },
          ]}
          value={filter}
          onChange={(v) => {
            setFilter(v);
          }}
          data-testid="enrollment-state-filter"
          size="xs"
        />

        {filtered.length === 0 ? (
          <Text size="sm" c="var(--mantine-color-gray-7)" data-testid="enrollment-empty-state">
            No enrollments{filter !== 'all' ? ` with state "${filter}"` : ''}.
          </Text>
        ) : (
          <Table striped highlightOnHover data-testid="enrollment-table">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Subject</Table.Th>
                <Table.Th>SANs</Table.Th>
                <Table.Th>State</Table.Th>
                <Table.Th>Requested</Table.Th>
                <Table.Th>Issued / Revoked</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filtered.map((enrollment) => (
                <Table.Tr
                  key={enrollment.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    setSelectedEnrollment(enrollment);
                  }}
                  data-testid={`enrollment-row-${enrollment.id}`}
                >
                  <Table.Td>
                    <Text size="sm">{enrollment.subject}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c="var(--mantine-color-gray-7)" lineClamp={1}>
                      {enrollment.dns_sans.length > 0 ? enrollment.dns_sans.join(', ') : '—'}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge
                      color={STATE_BADGE_COLOR[enrollment.state]}
                      variant="light"
                      size="sm"
                      data-testid={`enrollment-state-badge-${enrollment.id}`}
                    >
                      {enrollment.state}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{formatDate(enrollment.requested_at)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">
                      {enrollment.state === 'issued'
                        ? formatDate(enrollment.issued_at)
                        : enrollment.state === 'revoked'
                          ? formatDate(enrollment.revoked_at)
                          : '—'}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Stack>

      <CreateEnrollmentModal
        opened={createOpen}
        onClose={() => {
          setCreateOpen(false);
        }}
        tenantId={tenantId}
        canWrite={canWrite}
      />

      <EnrollmentDetailDrawer
        enrollment={selectedEnrollment}
        caName={selectedEnrollment ? (caMap[selectedEnrollment.ca_id] ?? 'Unknown CA') : ''}
        canWrite={canWrite}
        onClose={() => {
          setSelectedEnrollment(null);
        }}
        onRevoked={() => {
          setSelectedEnrollment(null);
        }}
      />
    </>
  );
}
