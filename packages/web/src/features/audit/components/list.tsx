/**
 * <AuditList> — DataTable of audit entries for a tenant.
 *
 * Columns (left → right):
 *   - at         — relative timestamp with full-ISO tooltip
 *   - actor      — user chip (name + truncated id); IP shown in tooltip with
 *                  audit:read-sensitive
 *   - action     — monospace text (e.g. `service.create`)
 *   - resource   — resource_type + IdBadge for resource_id
 *   - outcome    — success green / denied orange / error red
 *   - tier       — read (blue) / read-sensitive (violet) / write (yellow) /
 *                  destructive (red)
 *   - TOTP       — shield icon when `totp_verified === true`
 *   - actions    — view-detail icon button
 *
 * Row click → onSelect(entry) → parent opens <AuditDetail> drawer.
 */
import { useMemo } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import {
  ActionIcon,
  Badge,
  Box,
  Group,
  Text,
  Tooltip,
} from '@mantine/core';
import {
  IconEye,
  IconFileText,
  IconShieldCheck,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { IdBadge } from '@/components/id-badge';
import { usePermission } from '@/hooks/use-permission';
import { useMockStore } from '@/api/mock-store';
import type { AuditEntry } from '@/api/resources/types';

dayjs.extend(relativeTime);

const OUTCOME_COLOR: Record<AuditEntry['outcome'], string> = {
  success: 'green',
  denied: 'orange',
  error: 'red',
};

const TIER_COLOR: Record<AuditEntry['tier'], string> = {
  read: 'blue',
  'read-sensitive': 'violet',
  write: 'yellow',
  destructive: 'red',
};

export interface AuditListProps {
  /** Pre-filtered + sorted rows to render. Sorting is the caller's
   *  responsibility so we can share the list between paged + infinite
   *  views without re-sorting per render. */
  rows: AuditEntry[];
  onSelect: (entry: AuditEntry) => void;
}

export function AuditList({ rows, onSelect }: AuditListProps) {
  const users = useMockStore((s) => s.users);
  const canReadSensitive = usePermission('audit:read-sensitive');

  const columns = useMemo<ColumnDef<AuditEntry>[]>(
    () => [
      {
        id: 'at',
        header: 'When',
        size: 140,
        accessorFn: (row) => row.at,
        cell: ({ row }) => {
          const e = row.original;
          const absolute = dayjs(e.at).format('YYYY-MM-DD HH:mm:ss');
          return (
            <Tooltip label={absolute} withArrow>
              <Text size="xs" ff="monospace">
                {dayjs(e.at).fromNow()}
              </Text>
            </Tooltip>
          );
        },
      },
      {
        id: 'actor',
        header: 'Actor',
        size: 220,
        accessorFn: (row) => users[row.actor_id]?.name ?? row.actor_id,
        cell: ({ row }) => {
          const e = row.original;
          const user = users[e.actor_id];
          const name = user?.name ?? e.actor_id;
          const tooltipLines: string[] = [`id: ${e.actor_id}`];
          if (canReadSensitive && e.ip) {
            tooltipLines.push(`ip: ${e.ip}`);
          }
          return (
            <Tooltip
              label={tooltipLines.join('\n')}
              multiline
              withArrow
              style={{ whiteSpace: 'pre-line' }}
            >
              <Group gap={4} wrap="nowrap">
                <Text size="xs" fw={500}>
                  {name}
                </Text>
                {e.acted_as_admin && (
                  <Badge size="xs" color="violet" variant="light">
                    admin
                  </Badge>
                )}
              </Group>
            </Tooltip>
          );
        },
      },
      {
        id: 'action',
        header: 'Action',
        size: 200,
        accessorFn: (row) => row.action,
        cell: ({ getValue }) => (
          <Text size="xs" ff="monospace">
            {getValue<string>()}
          </Text>
        ),
      },
      {
        id: 'resource',
        header: 'Resource',
        size: 220,
        accessorFn: (row) =>
          `${row.resource_type}${row.resource_id ? `:${row.resource_id}` : ''}`,
        cell: ({ row }) => {
          const e = row.original;
          return (
            <Group gap={4} wrap="nowrap">
              <Badge size="xs" variant="outline" color="gray">
                {e.resource_type}
              </Badge>
              {e.resource_id && (
                <Box onClick={(ev) => { ev.stopPropagation(); }}>
                  <IdBadge id={e.resource_id} />
                </Box>
              )}
            </Group>
          );
        },
      },
      {
        id: 'outcome',
        header: 'Outcome',
        size: 100,
        accessorFn: (row) => row.outcome,
        cell: ({ getValue }) => {
          const v = getValue<AuditEntry['outcome']>();
          return (
            <Badge size="xs" variant="light" color={OUTCOME_COLOR[v]}>
              {v}
            </Badge>
          );
        },
      },
      {
        id: 'tier',
        header: 'Tier',
        size: 120,
        accessorFn: (row) => row.tier,
        cell: ({ getValue }) => {
          const v = getValue<AuditEntry['tier']>();
          return (
            <Badge size="xs" variant="outline" color={TIER_COLOR[v]}>
              {v}
            </Badge>
          );
        },
      },
      {
        id: 'totp',
        // Visible "TOTP" label so the sortable header button has discernible
        // text (axe `button-name`). Keep the column compact — the value
        // cell is a single icon, not a text string.
        header: 'TOTP',
        size: 56,
        accessorFn: (row) => row.totp_verified === true,
        cell: ({ row }) => {
          const e = row.original;
          if (e.totp_verified !== true) return null;
          return (
            <Tooltip label="TOTP verified" withArrow>
              <IconShieldCheck
                size={14}
                color="var(--mantine-color-teal-6)"
                aria-label="TOTP verified"
                role="img"
              />
            </Tooltip>
          );
        },
      },
      {
        id: 'actions',
        header: '',
        size: 50,
        enableSorting: false,
        cell: ({ row }) => (
          <ActionIcon
            size="sm"
            variant="subtle"
            aria-label="View audit entry details"
            onClick={(ev) => {
              ev.stopPropagation();
              onSelect(row.original);
            }}
            data-testid={`audit-row-view-${row.original.id}`}
          >
            <IconEye size={14} />
          </ActionIcon>
        ),
      },
    ],
    [users, canReadSensitive, onSelect],
  );

  return (
    <DataTable
      data={rows}
      columns={columns}
      sorting
      pagination={{ pageSize: 50 }}
      urlSyncKey="audit"
      onRowClick={onSelect}
      emptyState={
        <EmptyState
          icon={IconFileText}
          title="No audit entries"
          description="No entry matches the current filters — widen the date range or clear filters to see more."
        />
      }
      caption="Audit entries"
    />
  );
}
