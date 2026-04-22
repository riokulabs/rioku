/**
 * <TlsCertList> — TLS certificate list for the TLS settings section.
 *
 * Shows ACME + manual certificates for the current tenant.
 * Task 8b.8
 */
import { useState } from 'react';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Code,
  Drawer,
  Group,
  Menu,
  Modal,
  Stack,
  Switch,
  Table,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { IconDots, IconLock, IconPlus, IconTrash } from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import type { TlsCertificate } from '@/api/resources/types';
import { useTlsCertificates, deleteTlsCertificate, toggleCertAutoRenew } from '../api';
import { TlsUploadModal } from './tls-upload-modal';

// ─── Props ────────────────────────────────────────────────────────────────────

interface TlsCertListProps {
  tenantId: string;
  canWrite: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ISSUER_BADGE_COLOR: Record<string, string> = {
  "Let's Encrypt": 'green',
  ZeroSSL: 'blue',
  Manual: 'gray',
  'Self-signed': 'yellow',
};

function getIssuerColor(issuer: string): string {
  return ISSUER_BADGE_COLOR[issuer] ?? 'indigo';
}

/**
 * Returns a human-readable relative-time string for a given ISO-8601 date.
 * e.g. "in 45 days", "30 days ago", "expired"
 */
function relativeExpiry(isoDate: string): string {
  try {
    const diff = new Date(isoDate).getTime() - Date.now();
    const days = Math.round(diff / (1000 * 60 * 60 * 24));
    if (days < 0) {
      return `${String(Math.abs(days))} days ago`;
    }
    if (days === 0) return 'today';
    return `in ${String(days)} days`;
  } catch {
    return isoDate;
  }
}

function isExpired(isoDate: string): boolean {
  try {
    return new Date(isoDate).getTime() < Date.now();
  } catch {
    return false;
  }
}

function isExpiringSoon(isoDate: string): boolean {
  try {
    const diff = new Date(isoDate).getTime() - Date.now();
    return diff > 0 && diff < 30 * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

// ─── PEM detail drawer ────────────────────────────────────────────────────────

interface PemDrawerProps {
  cert: TlsCertificate | null;
  onClose: () => void;
}

function PemDrawer({ cert, onClose }: PemDrawerProps) {
  if (!cert) return null;

  // duration=0 prevents JSDOM animation hangs in tests
  return (
    <Drawer
      opened
      onClose={onClose}
      title={`Certificate PEM — ${cert.domain}`}
      position="right"
      size="min(400px, 95vw)"
      data-testid="cert-pem-drawer"
      transitionProps={{ duration: 0 }}
    >
      <Stack gap="md">
        <Stack gap={4}>
          <Text size="sm" fw={500}>
            Domain
          </Text>
          <Text size="sm" c="var(--mantine-color-gray-7)">
            {cert.domain}
          </Text>
        </Stack>
        <Stack gap={4}>
          <Text size="sm" fw={500}>
            Issuer
          </Text>
          <Text size="sm" c="var(--mantine-color-gray-7)">
            {cert.issuer}
          </Text>
        </Stack>
        <Stack gap={4}>
          <Text size="sm" fw={500}>
            Expires
          </Text>
          <Text
            size="sm"
            c={
              isExpired(cert.expires_at)
                ? 'red'
                : isExpiringSoon(cert.expires_at)
                  ? 'orange'
                  : 'var(--mantine-color-gray-7)'
            }
          >
            {relativeExpiry(cert.expires_at)}
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
            {cert.fingerprint_sha256}
          </Text>
        </Stack>
        {cert.certificate_pem.length > 0 ? (
          <Stack gap={4}>
            <Text size="sm" fw={500}>
              Certificate PEM
            </Text>
            <Code block style={{ maxHeight: 300, overflow: 'auto', fontSize: 12 }}>
              {cert.certificate_pem}
            </Code>
          </Stack>
        ) : (
          <Text size="sm" c="var(--mantine-color-gray-7)">
            PEM not stored — ACME-managed certificate.
          </Text>
        )}
      </Stack>
    </Drawer>
  );
}

// ─── Delete confirm modal ─────────────────────────────────────────────────────

interface DeleteConfirmProps {
  cert: TlsCertificate | null;
  onClose: () => void;
  onDeleted: () => void;
}

function DeleteConfirmModal({ cert, onClose, onDeleted }: DeleteConfirmProps) {
  const [deleting, setDeleting] = useState(false);

  if (!cert) return null;

  async function handleDelete() {
    if (!cert) return;
    setDeleting(true);
    try {
      await deleteTlsCertificate(cert.id);
      notify.success('Certificate deleted', `"${cert.domain}" has been removed.`);
      onDeleted();
      onClose();
    } catch (e) {
      notify.error('Delete failed', (e as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  // duration=0 prevents JSDOM animation hangs in tests
  return (
    <Modal
      opened
      onClose={onClose}
      title="Delete certificate"
      size="sm"
      data-testid="delete-cert-modal"
      transitionProps={{ duration: 0 }}
    >
      <Stack gap="sm">
        <Text size="sm">
          Are you sure you want to delete the certificate for <strong>{cert.domain}</strong>? This
          cannot be undone.
        </Text>
        <Group justify="flex-end" mt="sm">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            color="red"
            loading={deleting}
            onClick={() => {
              void handleDelete();
            }}
            data-testid="confirm-delete-cert-button"
          >
            Delete
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TlsCertList({ tenantId, canWrite }: TlsCertListProps) {
  const certs = useTlsCertificates();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [pemCert, setPemCert] = useState<TlsCertificate | null>(null);
  const [deletingCert, setDeletingCert] = useState<TlsCertificate | null>(null);
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());

  async function handleToggleAutoRenew(cert: TlsCertificate, enabled: boolean) {
    if (!canWrite) return;
    setTogglingIds((prev) => new Set(prev).add(cert.id));
    try {
      await toggleCertAutoRenew(cert.id, enabled);
    } catch (e) {
      notify.error('Toggle failed', (e as Error).message);
    } finally {
      setTogglingIds((prev) => {
        const next = new Set(prev);
        next.delete(cert.id);
        return next;
      });
    }
  }

  return (
    <>
      <Stack gap="sm" data-testid="tls-cert-list">
        <Group justify="space-between" align="center" wrap="wrap">
          <Title order={5}>TLS Certificates</Title>
          <Tooltip label="Requires tls:write permission" disabled={canWrite}>
            <span>
              <Button
                size="sm"
                leftSection={!canWrite ? <IconLock size={14} /> : <IconPlus size={14} />}
                disabled={!canWrite}
                onClick={() => {
                  setUploadOpen(true);
                }}
                data-testid="upload-cert-button"
              >
                Upload certificate
              </Button>
            </span>
          </Tooltip>
        </Group>

        {certs.length === 0 ? (
          <Text size="sm" c="var(--mantine-color-gray-7)" data-testid="cert-empty-state">
            No TLS certificates configured.
          </Text>
        ) : (
          <Box style={{ overflowX: 'auto' }}>
            <Table striped highlightOnHover data-testid="cert-table">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Domain</Table.Th>
                  <Table.Th>Issuer</Table.Th>
                  <Table.Th>Expires</Table.Th>
                  <Table.Th>Auto-renew</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {certs.map((cert) => (
                  <Table.Tr key={cert.id} data-testid={`cert-row-${cert.id}`}>
                    <Table.Td>
                      <Text size="sm" fw={500}>
                        {cert.domain}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        color={getIssuerColor(cert.issuer)}
                        variant="light"
                        size="sm"
                        data-testid={`cert-issuer-badge-${cert.id}`}
                      >
                        {cert.issuer}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      {isExpired(cert.expires_at) ? (
                        <Text size="sm" c="red" data-testid={`cert-expiry-${cert.id}`}>
                          {relativeExpiry(cert.expires_at)}
                        </Text>
                      ) : isExpiringSoon(cert.expires_at) ? (
                        <Text size="sm" c="orange" data-testid={`cert-expiry-${cert.id}`}>
                          {relativeExpiry(cert.expires_at)}
                        </Text>
                      ) : (
                        <Text size="sm" data-testid={`cert-expiry-${cert.id}`}>
                          {relativeExpiry(cert.expires_at)}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Tooltip
                        label={
                          cert.source === 'manual'
                            ? 'Auto-renew not available for manually uploaded certs'
                            : !canWrite
                              ? 'Requires tls:write permission'
                              : ''
                        }
                        disabled={cert.source === 'acme' && canWrite}
                      >
                        <span>
                          <Switch
                            size="sm"
                            checked={cert.auto_renew}
                            disabled={
                              cert.source === 'manual' || !canWrite || togglingIds.has(cert.id)
                            }
                            onChange={(e) => {
                              void handleToggleAutoRenew(cert, e.currentTarget.checked);
                            }}
                            aria-label={`Auto-renew for ${cert.domain}`}
                            data-testid={`cert-auto-renew-${cert.id}`}
                          />
                        </span>
                      </Tooltip>
                    </Table.Td>
                    <Table.Td>
                      <Menu position="bottom-end" withinPortal>
                        <Menu.Target>
                          <ActionIcon
                            variant="subtle"
                            size="sm"
                            aria-label={`Certificate actions for ${cert.domain}`}
                            data-testid={`cert-actions-${cert.id}`}
                          >
                            <IconDots size={14} />
                          </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown>
                          <Menu.Item
                            onClick={() => {
                              setPemCert(cert);
                            }}
                            data-testid={`cert-view-pem-${cert.id}`}
                          >
                            View PEM
                          </Menu.Item>
                          <Tooltip label="Requires tls:write permission" disabled={canWrite}>
                            <div>
                              <Menu.Item
                                color="red"
                                leftSection={<IconTrash size={14} />}
                                disabled={!canWrite}
                                onClick={() => {
                                  if (canWrite) setDeletingCert(cert);
                                }}
                                data-testid={`cert-delete-${cert.id}`}
                              >
                                Delete
                              </Menu.Item>
                            </div>
                          </Tooltip>
                        </Menu.Dropdown>
                      </Menu>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Box>
        )}
      </Stack>

      <TlsUploadModal
        opened={uploadOpen}
        onClose={() => {
          setUploadOpen(false);
        }}
        tenantId={tenantId}
        canWrite={canWrite}
      />

      <PemDrawer
        cert={pemCert}
        onClose={() => {
          setPemCert(null);
        }}
      />

      <DeleteConfirmModal
        cert={deletingCert}
        onClose={() => {
          setDeletingCert(null);
        }}
        onDeleted={() => {
          setDeletingCert(null);
        }}
      />
    </>
  );
}
