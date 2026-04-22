/**
 * <AdminAuditView> — super-admin cross-tenant audit log with chain verification.
 *
 * spec §8.1 / Task 1d.78
 */
import { useState, useMemo } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { Stack, Title, Group, Button, Badge, Text, Alert } from '@mantine/core';
import { IconShieldCheck, IconShieldOff, IconFileText } from '@tabler/icons-react';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { IdBadge } from '@/components/id-badge';
import { useMockStore } from '@/api/mock-store';
import { verifyAdminAuditChain } from '@/api/resources/audit';
import type { AdminAuditEntry } from '@/api/resources/types';

type VerifyResult =
  | { status: 'idle' }
  | { status: 'verifying' }
  | { status: 'valid' }
  | { status: 'broken'; entry: number };

export function AdminAuditView() {
  const adminAudit = useMockStore((s) => s.adminAudit);
  const users = useMockStore((s) => s.users);

  const [verifyResult, setVerifyResult] = useState<VerifyResult>({ status: 'idle' });

  const sortedEntries = useMemo(
    () => [...adminAudit].sort((a, b) => b.at.localeCompare(a.at)),
    [adminAudit],
  );

  async function handleVerify() {
    setVerifyResult({ status: 'verifying' });
    const result = await verifyAdminAuditChain(adminAudit);
    if (result.ok) {
      setVerifyResult({ status: 'valid' });
    } else {
      setVerifyResult({ status: 'broken', entry: result.brokenAt ?? 0 });
    }
  }

  function actorName(entry: AdminAuditEntry): string {
    const user = users[entry.actor_id];
    return user ? user.name : entry.actor_id;
  }

  const columns: ColumnDef<AdminAuditEntry>[] = [
    {
      accessorKey: 'at',
      header: 'Timestamp',
      cell: (info) => (
        <Text size="xs" ff="monospace">
          {new Date(info.getValue<string>()).toLocaleString()}
        </Text>
      ),
    },
    {
      id: 'actor',
      header: 'Actor',
      cell: (info) => <Text size="sm">{actorName(info.row.original)}</Text>,
    },
    {
      accessorKey: 'action',
      header: 'Action',
      cell: (info) => (
        <Badge variant="light" size="sm">
          {info.getValue<string>()}
        </Badge>
      ),
    },
    {
      id: 'tenant',
      header: 'Tenant',
      cell: (info) => (
        <Text size="sm" c="dimmed">
          {info.row.original.tenant_id ?? '—'}
        </Text>
      ),
    },
    {
      id: 'resource',
      header: 'Resource',
      cell: (info) => (
        <Text size="sm" c="dimmed">
          {info.row.original.resource_type}
        </Text>
      ),
    },
    {
      id: 'hash',
      header: 'Hash',
      cell: (info) => <IdBadge id={info.row.original.hash} />,
    },
  ];

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between" align="center">
        <Title order={2}>Admin audit log</Title>
        <Group gap="sm">
          {verifyResult.status === 'valid' && (
            <Badge
              color="green"
              variant="light"
              leftSection={<IconShieldCheck size={12} />}
              size="lg"
              data-testid="chain-verified-badge"
            >
              Chain verified
            </Badge>
          )}
          {verifyResult.status === 'broken' && (
            <Badge
              color="red"
              variant="light"
              leftSection={<IconShieldOff size={12} />}
              size="lg"
              data-testid="chain-broken-badge"
            >
              Broken at entry {verifyResult.entry}
            </Badge>
          )}
          <Button
            variant="light"
            leftSection={<IconShieldCheck size={16} />}
            onClick={() => {
              void handleVerify();
            }}
            loading={verifyResult.status === 'verifying'}
          >
            Verify chain
          </Button>
        </Group>
      </Group>

      {sortedEntries.length === 0 ? (
        <EmptyState
          icon={IconFileText}
          title="No admin audit entries"
          description="Admin audit entries are created when super-admin actions occur."
        />
      ) : (
        <>
          {verifyResult.status === 'broken' && (
            <Alert color="red" icon={<IconShieldOff size={16} />} title="Chain integrity broken">
              The hash chain is broken at entry {verifyResult.entry}. This may indicate tampering.
            </Alert>
          )}
          <DataTable columns={columns} data={sortedEntries} />
        </>
      )}
    </Stack>
  );
}
