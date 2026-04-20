/**
 * <SignerList> — DataTable of plugin signers visible under a scope.
 *
 * Columns:
 *   - name (+ description subtext)
 *   - fingerprint (mono, truncated 16-char; full via tooltip, copyable via IdBadge)
 *   - scope (Global chip vs tenant slug chip)
 *   - status chip (verified green / revoked red / pending gray)
 *   - plugin count (derived via useSignerPlugins wrapper)
 *   - actions menu (Verify / Revoke / Delete — permission-gated)
 *
 * The list receives a `tenantId` param that scopes the listing:
 *   - tenantId === null → super-admin view (global signers; pass separate lists
 *     for each tenant at the caller level if needed). Plan 6 keeps these
 *     flat-listed per scope.
 *   - tenantId string → tenant-scoped signers only.
 */
import { useMemo } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import {
  ActionIcon,
  Badge,
  CopyButton,
  Group,
  Menu,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import {
  IconCheck,
  IconCircleCheck,
  IconCircleX,
  IconClock,
  IconCopy,
  IconDots,
  IconShieldCheck,
  IconShieldLock,
  IconTrash,
} from '@tabler/icons-react';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { usePermission } from '@/hooks/use-permission';
import { useMockStore } from '@/api/mock-store';
import { useSignerList } from '../api';
import type { PluginSigner, SignerFilter } from '../types';

interface SignerListProps {
  /** null = global signers only (super-admin view); string = tenant-scoped. */
  tenantScope: string | null;
  filter: SignerFilter;
  onSelect: (signer: PluginSigner) => void;
  onVerify: (signer: PluginSigner) => void;
  onRevoke: (signer: PluginSigner) => void;
  onDelete: (signer: PluginSigner) => void;
}

const STATUS_CONFIG: Record<
  PluginSigner['status'],
  { color: string; Icon: typeof IconCircleCheck; label: string }
> = {
  verified: { color: 'green', Icon: IconCircleCheck, label: 'verified' },
  revoked: { color: 'red', Icon: IconCircleX, label: 'revoked' },
  pending: { color: 'gray', Icon: IconClock, label: 'pending' },
};

function fingerprintShort(fp: string): string {
  if (fp.length <= 16) return fp;
  return `${fp.slice(0, 16)}…`;
}

/** Counts plugins referencing each signer id (derived outside the selector). */
function usePluginCountsBySigner(): Record<string, number> {
  const plugins = useMockStore((s) => s.plugins);
  const out: Record<string, number> = {};
  for (const p of Object.values(plugins)) {
    if (p.signer_id) {
      out[p.signer_id] = (out[p.signer_id] ?? 0) + 1;
    }
  }
  return out;
}

export function SignerList({
  tenantScope,
  filter,
  onSelect,
  onVerify,
  onRevoke,
  onDelete,
}: SignerListProps) {
  const signers = useSignerList(tenantScope);
  const pluginCounts = usePluginCountsBySigner();
  const canWrite = usePermission('plugin-signer:write');
  const canDelete = usePermission('plugin-signer:delete');

  const filtered = useMemo(() => {
    const q = filter.search.toLowerCase().trim();
    const statusSet = new Set(filter.statuses);
    return signers.filter((s) => {
      if (statusSet.size > 0 && !statusSet.has(s.status)) return false;
      if (q) {
        const nameMatch = s.name.toLowerCase().includes(q);
        const fpMatch = s.fingerprint.toLowerCase().includes(q);
        if (!nameMatch && !fpMatch) return false;
      }
      return true;
    });
  }, [signers, filter.search, filter.statuses]);

  const columns = useMemo<ColumnDef<PluginSigner>[]>(
    () => [
      {
        id: 'name',
        header: 'Name',
        accessorFn: (row) => row.name,
        cell: ({ row }) => {
          const s = row.original;
          return (
            <Stack gap={2}>
              <Text size="sm" fw={500}>
                {s.name}
              </Text>
              {s.description && (
                <Text
                  size="xs"
                  c="var(--mantine-color-gray-7)"
                  lineClamp={1}
                  title={s.description}
                >
                  {s.description}
                </Text>
              )}
            </Stack>
          );
        },
      },
      {
        id: 'fingerprint',
        header: 'Fingerprint',
        accessorFn: (row) => row.fingerprint,
        cell: ({ row }) => {
          const s = row.original;
          return (
            <Group gap={4} wrap="nowrap">
              <Tooltip label={s.fingerprint} withArrow>
                <Text size="xs" ff="monospace" style={{ userSelect: 'all' }}>
                  {fingerprintShort(s.fingerprint)}
                </Text>
              </Tooltip>
              <CopyButton value={s.fingerprint} timeout={2000}>
                {({ copied, copy }) => (
                  <ActionIcon
                    size="xs"
                    variant="subtle"
                    color={copied ? 'teal' : 'gray'}
                    onClick={(e) => {
                      e.stopPropagation();
                      copy();
                    }}
                    aria-label="Copy fingerprint"
                  >
                    {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
                  </ActionIcon>
                )}
              </CopyButton>
            </Group>
          );
        },
      },
      {
        id: 'scope',
        header: 'Scope',
        size: 120,
        accessorFn: (row) => row.tenant_scope ?? 'global',
        cell: ({ row }) => {
          const s = row.original;
          return s.tenant_scope === null ? (
            <Badge size="xs" color="indigo" variant="light">
              Global
            </Badge>
          ) : (
            <Badge size="xs" color="gray" variant="outline" ff="monospace">
              {s.tenant_scope}
            </Badge>
          );
        },
      },
      {
        id: 'status',
        header: 'Status',
        size: 110,
        accessorFn: (row) => row.status,
        cell: ({ row }) => {
          const cfg = STATUS_CONFIG[row.original.status];
          return (
            <Badge
              size="sm"
              color={cfg.color}
              variant="light"
              leftSection={<cfg.Icon size={10} />}
            >
              {cfg.label}
            </Badge>
          );
        },
      },
      {
        id: 'plugins',
        header: 'Plugins',
        size: 90,
        accessorFn: (row) => pluginCounts[row.id] ?? 0,
        cell: ({ getValue }) => {
          const n = getValue<number>();
          return <Text size="sm">{String(n)}</Text>;
        },
      },
      {
        id: 'actions',
        header: '',
        size: 60,
        cell: ({ row }) => {
          const s = row.original;
          const disableVerify = !canWrite || s.status === 'verified';
          const disableRevoke = !canWrite || s.status === 'revoked';
          return (
            <Menu shadow="md" width={180} position="bottom-end" withinPortal>
              <Menu.Target>
                <ActionIcon
                  variant="subtle"
                  aria-label={`Actions for ${s.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                >
                  <IconDots size={16} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item
                  leftSection={<IconShieldCheck size={14} />}
                  disabled={disableVerify}
                  onClick={(e) => {
                    e.stopPropagation();
                    onVerify(s);
                  }}
                >
                  Verify
                </Menu.Item>
                <Menu.Item
                  leftSection={<IconShieldLock size={14} />}
                  disabled={disableRevoke}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRevoke(s);
                  }}
                >
                  Revoke
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item
                  color="red"
                  disabled={!canDelete}
                  leftSection={<IconTrash size={14} />}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(s);
                  }}
                >
                  Delete…
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          );
        },
      },
    ],
    [onVerify, onRevoke, onDelete, pluginCounts, canWrite, canDelete],
  );

  return (
    <DataTable
      data={filtered}
      columns={columns}
      sorting
      pagination={{ pageSize: 20 }}
      urlSyncKey="plugin-signers"
      onRowClick={onSelect}
      emptyState={
        <EmptyState
          icon={IconShieldCheck}
          title="No signers"
          description="Add a plugin signer to the allow-list to trust published plugins."
        />
      }
      caption="Plugin signers"
    />
  );
}
