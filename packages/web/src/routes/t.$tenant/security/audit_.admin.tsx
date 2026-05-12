/**
 * Tenant-scoped admin audit log — /t/$tenant/security/audit/admin
 *
 * Displays the hash-chained admin audit log for a single tenant. Only
 * entries whose `tenant_id` matches the current tenant are shown.
 *
 * Shape:
 *   Header (title + "Verify chain" button + chain status badge)
 *   DataTable (timestamp, actor, action, resource, kind, hash chip)
 *   Expandable detail (prev_hash, hash, policies evaluated)
 *
 * Permission guard: requires `admin:cross-tenant-read`.
 * Daemon endpoint: `/api/v1/t/:tenant/audit/admin` (hash-chained response).
 */
import { useState, useMemo, useCallback } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { type ColumnDef } from '@tanstack/react-table';
import {
  Accordion,
  Alert,
  Anchor,
  Badge,
  Button,
  Code,
  Group,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { IconArrowLeft, IconShieldCheck, IconShieldOff } from '@tabler/icons-react';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { IdBadge } from '@/components/id-badge';
import { requirePermissions } from '@/hooks/use-before-load';
import { verifyAdminAuditChain } from '@/api/resources/audit';
import type { AdminAuditEntry } from '@/api/resources';
import { useListAdminAudit } from '@/api/generated/admin/admin';
import { useUserList } from '@/features/security/users';

// ─── Verify state ────────────────────────────────────────────────────────────

type VerifyStatus =
  | { status: 'idle' }
  | { status: 'verifying' }
  | { status: 'valid' }
  | { status: 'broken'; brokenAt: number };

// ─── Page component ──────────────────────────────────────────────────────────

function TenantAdminAuditPage() {
  const { tenant } = Route.useParams();
  const tenantId = tenant;
  const tenantSlug = tenant;

  // Stage-2: hydrate user lookup from the daemon-backed user list.
  const usersResult = useUserList(tenantId, { search: '', status: 'all' });
  const users = useMemo(() => {
    const out: Record<string, { id: string; name: string; email: string }> = {};
    for (const item of usersResult.items) {
      out[item.user.id] = {
        id: item.user.id,
        name: item.user.name,
        email: item.user.email,
      };
    }
    return out;
  }, [usersResult.items]);

  // Stage-2: admin audit feed comes from the cross-tenant admin endpoint.
  const { data: adminAuditResp } = useListAdminAudit();
  const allAdminAudit = useMemo<AdminAuditEntry[]>(() => {
    const raw = adminAuditResp?.data.items;
    return Array.isArray(raw) ? (raw as unknown as AdminAuditEntry[]) : [];
  }, [adminAuditResp]);
  const ascending = useMemo(
    () => allAdminAudit.filter((e) => e.tenant_id === tenantId),
    [allAdminAudit, tenantId],
  );
  const entries = useMemo(
    () => [...ascending].sort((a, b) => b.at.localeCompare(a.at)),
    [ascending],
  );

  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>({ status: 'idle' });

  const handleVerify = useCallback(async () => {
    setVerifyStatus({ status: 'verifying' });
    const result = await verifyAdminAuditChain(ascending);
    if (result.ok) {
      setVerifyStatus({ status: 'valid' });
    } else {
      setVerifyStatus({ status: 'broken', brokenAt: result.brokenAt ?? 0 });
    }
  }, [ascending]);

  function actorLabel(entry: AdminAuditEntry): string {
    const user = users[entry.actor_id];
    return user ? `${user.name} <${user.email}>` : entry.actor_id;
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
      cell: (info) => <Text size="sm">{actorLabel(info.row.original)}</Text>,
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
      accessorKey: 'resource_type',
      header: 'Resource',
      cell: (info) => (
        <Text size="sm" c="var(--mantine-color-gray-7)">
          {info.getValue<string>()}
        </Text>
      ),
    },
    {
      accessorKey: 'kind',
      header: 'Kind',
      cell: () => (
        <Badge variant="outline" size="xs" color="violet">
          admin
        </Badge>
      ),
    },
    {
      accessorKey: 'hash',
      header: 'Hash',
      cell: (info) => <IdBadge id={info.getValue<string>()} />,
    },
  ];

  return (
    <Stack gap="md" p="md" data-testid="tenant-admin-audit-page">
      <Group gap="xs">
        <Anchor
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
          component={Link as any}
          to="/t/$tenant/security/audit"
          params={{ tenant: tenantSlug }}
          size="sm"
          data-testid="admin-audit-back"
        >
          <Group gap={4} align="center">
            <IconArrowLeft size={14} />
            <span>Back to audit log</span>
          </Group>
        </Anchor>
      </Group>

      <Group justify="space-between" align="center">
        <Stack gap={2}>
          <Title order={2}>Admin audit log</Title>
          <Text size="sm" c="dimmed">
            Hash-chained super-admin entries for this tenant
          </Text>
        </Stack>
        <Group gap="sm">
          {verifyStatus.status === 'valid' && (
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
          {verifyStatus.status === 'broken' && (
            <Badge
              color="red"
              variant="light"
              leftSection={<IconShieldOff size={12} />}
              size="lg"
              data-testid="chain-broken-badge"
            >
              Broken at entry {verifyStatus.brokenAt}
            </Badge>
          )}
          <Button
            variant="light"
            leftSection={<IconShieldCheck size={16} />}
            loading={verifyStatus.status === 'verifying'}
            onClick={() => {
              void handleVerify();
            }}
            data-testid="verify-chain-button"
          >
            Verify chain
          </Button>
        </Group>
      </Group>

      {verifyStatus.status === 'broken' && (
        <Alert color="red" icon={<IconShieldOff size={16} />} title="Chain integrity broken">
          The hash chain is broken at entry {verifyStatus.brokenAt}. This may indicate tampering.
        </Alert>
      )}

      {entries.length === 0 ? (
        <EmptyState
          icon={IconShieldCheck}
          title="No admin audit entries"
          description="Admin audit entries are created when super-admin actions occur for this tenant."
          data-testid="admin-audit-empty"
        />
      ) : (
        <>
          <DataTable columns={columns} data={entries} />

          <Accordion variant="separated">
            {entries.slice(0, 5).map((entry) => (
              <Accordion.Item key={entry.id} value={entry.id}>
                <Accordion.Control>
                  <Group gap="sm">
                    <Badge variant="light" size="sm">
                      {entry.action}
                    </Badge>
                    <Text size="xs" c="dimmed">
                      {new Date(entry.at).toLocaleString()}
                    </Text>
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  <Stack gap="xs">
                    <Group gap="xs">
                      <Text size="xs" fw={600}>
                        prev_hash:
                      </Text>
                      <Code fz="xs" data-testid={`prev-hash-${entry.id}`}>
                        {entry.prev_hash || '(genesis)'}
                      </Code>
                    </Group>
                    <Group gap="xs">
                      <Text size="xs" fw={600}>
                        hash:
                      </Text>
                      <Code fz="xs" data-testid={`hash-${entry.id}`}>
                        {entry.hash}
                      </Code>
                    </Group>
                    {entry.policies_evaluated && entry.policies_evaluated.length > 0 && (
                      <Stack gap={4}>
                        <Text size="xs" fw={600}>
                          Policies evaluated:
                        </Text>
                        {entry.policies_evaluated.map((p) => (
                          <Group key={p.policy_id} gap="xs">
                            <Badge
                              size="xs"
                              color={p.decision === 'allow' ? 'green' : 'red'}
                              variant="light"
                            >
                              {p.decision}
                            </Badge>
                            <Text size="xs">{p.policy_id}</Text>
                            {p.reason && (
                              <Text size="xs" c="dimmed">
                                — {p.reason}
                              </Text>
                            )}
                          </Group>
                        ))}
                      </Stack>
                    )}
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion>
        </>
      )}
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/security/audit_/admin')({
  beforeLoad: requirePermissions({ required: ['admin:cross-tenant-read'] }),
  component: TenantAdminAuditPage,
});
