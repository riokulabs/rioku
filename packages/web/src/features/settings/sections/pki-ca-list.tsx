/**
 * <PkiCaList> — Certificate Authority list for the PKI settings section.
 *
 * Shows internal + external CAs for the current tenant.
 * Task 8b.7
 */
import { useState } from 'react';
import {
  Badge,
  Button,
  Code,
  Drawer,
  Group,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { IconLock, IconPlus } from '@tabler/icons-react';
import type { CertAuthority } from '@/api/resources/types';
import { useCertAuthorities } from '../api';
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
  if (!ca) return null;

  return (
    <Drawer
      opened
      onClose={onClose}
      title={ca.name}
      position="right"
      size="min(400px, 95vw)"
      data-testid="ca-detail-drawer"
    >
      <Stack gap="md">
        <Stack gap={4}>
          <Text size="sm" fw={500}>Kind</Text>
          <Badge color={ca.kind === 'internal' ? 'green' : 'blue'} variant="light">
            {ca.kind}
          </Badge>
        </Stack>

        <Stack gap={4}>
          <Text size="sm" fw={500}>Subject</Text>
          <Text size="sm" c="var(--mantine-color-gray-7)">{ca.subject}</Text>
        </Stack>

        <Stack gap={4}>
          <Text size="sm" fw={500}>Issuer</Text>
          <Text size="sm" c="var(--mantine-color-gray-7)">{ca.issuer}</Text>
        </Stack>

        <Stack gap={4}>
          <Text size="sm" fw={500}>Valid from</Text>
          <Text size="sm" c="var(--mantine-color-gray-7)">{formatDate(ca.not_before)}</Text>
        </Stack>

        <Stack gap={4}>
          <Text size="sm" fw={500}>Valid until</Text>
          <Text size="sm" c="var(--mantine-color-gray-7)">{formatDate(ca.not_after)}</Text>
        </Stack>

        <Stack gap={4}>
          <Text size="sm" fw={500}>SHA-256 fingerprint</Text>
          <Text size="xs" ff="monospace" c="var(--mantine-color-gray-7)" style={{ wordBreak: 'break-all' }}>
            {ca.fingerprint_sha256}
          </Text>
        </Stack>

        {ca.certificate_pem.length > 0 && (
          <Stack gap={4}>
            <Text size="sm" fw={500}>Certificate PEM</Text>
            <Code block style={{ maxHeight: 300, overflow: 'auto', fontSize: 12 }}>
              {ca.certificate_pem}
            </Code>
          </Stack>
        )}

        <Tooltip label="Revocation available in stage 2" position="bottom">
          <span>
            <Button
              variant="light"
              color="red"
              size="sm"
              disabled
              data-testid="ca-revoke-button"
            >
              Revoke / Delete (stage 2)
            </Button>
          </span>
        </Tooltip>
      </Stack>
    </Drawer>
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
                onClick={() => { setCreateOpen(true); }}
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
                  onClick={() => { setSelectedCa(ca); }}
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
                    <Text size="sm" lineClamp={1}>{ca.subject}</Text>
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
        onClose={() => { setCreateOpen(false); }}
        tenantId={tenantId}
        canWrite={canWrite}
      />

      <CaDetailDrawer
        ca={selectedCa}
        onClose={() => { setSelectedCa(null); }}
      />
    </>
  );
}
