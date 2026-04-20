/**
 * <InboxDropdown> — bell-anchored notifications dropdown.
 *
 * Surface (top → bottom):
 *   - Header: "Notifications" title + "Mark all read" + "Open inbox" link
 *   - Chip.Group filter: All | System | Security | Audit | Plugins (multi-select)
 *   - Show-archived toggle
 *   - Scrollable grouped list: section per category with entries
 *       - severity icon (info/warn/error/success)
 *       - title (bold when unread) + body (2-line truncated)
 *       - relative time
 *       - optional action button (from notification.action)
 *       - mark-read + archive controls (permission-gated)
 *   - Empty / loading / error states
 *
 * Subscribes to the mock-SSE inbox bus via `subscribeInboxStream` so new
 * emits land in the dropdown even while it's open. The store update from
 * `emitNotification` also re-renders the list via Zustand; the bus hook
 * here exists primarily so consumers can hook side effects (badge flash)
 * in the future without re-plumbing.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Anchor,
  Badge,
  Box,
  Button,
  Chip,
  Divider,
  Group,
  ScrollArea,
  Stack,
  Switch,
  Text,
  Tooltip,
} from '@mantine/core';
import { Link } from '@tanstack/react-router';
import {
  IconAlertTriangle,
  IconArchive,
  IconBell,
  IconCheck,
  IconCircleCheck,
  IconCircleX,
  IconExternalLink,
  IconInfoCircle,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useMockStore } from '@/api/mock-store';
import { usePermission } from '@/hooks/use-permission';
import { notify } from '@/hooks/use-notify';
import {
  archive,
  markAllRead,
  markRead,
  subscribeInboxStream,
  useNotificationList,
} from '../api';
import type { ID, InboxFilter, NotificationItem } from '../types';

dayjs.extend(relativeTime);

// ─── Category filter chips ───────────────────────────────────────────────────

/**
 * Canonical filter buckets. "plugins" is a prefix bucket — a chip value of
 * `plugins` matches any category that starts with `plugin:`.
 */
const FILTER_BUCKETS: { value: string; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'security', label: 'Security' },
  { value: 'audit', label: 'Audit' },
  { value: 'plugins', label: 'Plugins' },
];

/** Expand selected bucket values to concrete categories matching the store. */
function bucketsToCategories(
  buckets: string[],
  all: NotificationItem[],
): string[] {
  const out = new Set<string>();
  const hasPlugins = buckets.includes('plugins');
  for (const b of buckets) {
    if (b !== 'plugins') out.add(b);
  }
  if (hasPlugins) {
    for (const n of all) {
      if (n.category.startsWith('plugin:')) out.add(n.category);
    }
  }
  return [...out];
}

// ─── Severity → visuals ──────────────────────────────────────────────────────

const SEVERITY_ICON: Record<NotificationItem['severity'], typeof IconInfoCircle> = {
  info: IconInfoCircle,
  warn: IconAlertTriangle,
  error: IconCircleX,
  success: IconCircleCheck,
};

const SEVERITY_COLOR: Record<NotificationItem['severity'], string> = {
  info: 'blue',
  warn: 'orange',
  error: 'red',
  success: 'green',
};

/** Human-readable category label — collapses `plugin:<slug>` to "Plugin <slug>". */
function formatCategoryLabel(category: string): string {
  if (category.startsWith('plugin:')) {
    return `Plugin · ${category.slice('plugin:'.length)}`;
  }
  if (category.length === 0) return 'Other';
  return category.charAt(0).toUpperCase() + category.slice(1);
}

// ─── Component ───────────────────────────────────────────────────────────────

export interface InboxDropdownProps {
  /** Current user ID — drives list/count selectors. */
  userId: ID;
  /** Called when the user clicks "Open inbox" or an entry action. */
  onClose: () => void;
}

export function InboxDropdown({ userId, onClose }: InboxDropdownProps) {
  const [selectedBuckets, setSelectedBuckets] = useState<string[]>([]);
  const [showArchived, setShowArchived] = useState(false);

  // Tenant slug is resolved from the current tenant in the store so the
  // "Open inbox" link routes to the right tenant scope. Falls back to the
  // first tenant the user belongs to.
  const tenants = useMockStore((s) => s.tenants);
  const currentTenantId = useMockStore((s) => s.currentTenantId);
  const tenantSlug = useMemo(() => {
    if (currentTenantId && tenants[currentTenantId]) {
      return tenants[currentTenantId].slug;
    }
    const first = Object.values(tenants)[0];
    return first?.slug ?? '';
  }, [tenants, currentTenantId]);

  const canManageOwn = usePermission('notification:manage-own');

  // Unfiltered view — used to resolve the "plugins" bucket into concrete
  // categories AND to show entries for selected filter buckets.
  const unfiltered = useNotificationList(userId, {
    categories: [],
    severities: [],
    unreadOnly: false,
    includeArchived: showArchived,
    search: '',
  });

  const filter = useMemo<InboxFilter>(
    () => ({
      categories: bucketsToCategories(selectedBuckets, unfiltered),
      severities: [],
      unreadOnly: false,
      includeArchived: showArchived,
      search: '',
    }),
    [selectedBuckets, unfiltered, showArchived],
  );

  const rows = useNotificationList(userId, filter);

  // Subscribe to new emits. Zustand drives the re-render already; this hook
  // exists so future work (toast-linked "what's new" flash on the dropdown,
  // etc.) can hook without re-plumbing. The listener is intentionally a
  // no-op side effect.
  useEffect(() => {
    const unsub = subscribeInboxStream(userId, () => {
      // no-op — Zustand selector picks up the store write.
    });
    return unsub;
  }, [userId]);

  // Group rows by category for display — keeps plugin categories separate
  // even when the "plugins" bucket expands them all into the same filter.
  const grouped = useMemo(() => {
    const map = new Map<string, NotificationItem[]>();
    for (const n of rows.slice(0, 50)) {
      const bucket = map.get(n.category) ?? [];
      bucket.push(n);
      map.set(n.category, bucket);
    }
    // Sort keys: built-ins first in canonical order, then plugin: alpha.
    const canonical = ['system', 'security', 'audit'];
    const keys = [...map.keys()].sort((a, b) => {
      const ai = canonical.indexOf(a);
      const bi = canonical.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    return keys.map((k) => ({ category: k, items: map.get(k) ?? [] }));
  }, [rows]);

  async function handleMarkRead(id: ID) {
    if (!canManageOwn) return;
    try {
      await markRead(id);
    } catch {
      notify.error('Mark read failed', 'Please try again.');
    }
  }

  async function handleArchive(id: ID) {
    if (!canManageOwn) return;
    try {
      await archive(id);
      notify.success('Archived', 'Notification moved to archive.');
    } catch {
      notify.error('Archive failed', 'Please try again.');
    }
  }

  async function handleMarkAll() {
    if (!canManageOwn) return;
    try {
      const n = await markAllRead(userId);
      if (n > 0) {
        notify.success('All read', `Marked ${String(n)} notifications read.`);
      }
    } catch {
      notify.error('Mark all read failed', 'Please try again.');
    }
  }

  return (
    <Stack gap={0} data-testid="inbox-dropdown">
      {/* Header */}
      <Group justify="space-between" align="center" px="sm" py="xs">
        <Group gap="xs" align="center">
          <IconBell size={16} />
          <Text fw={600} size="sm">
            Notifications
          </Text>
        </Group>
        <Group gap="xs">
          <Button
            variant="subtle"
            size="compact-xs"
            onClick={() => {
              void handleMarkAll();
            }}
            disabled={!canManageOwn}
            data-testid="inbox-dropdown-mark-all"
          >
            Mark all read
          </Button>
          <Anchor
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment -- TanStack Link + Mantine polymorphic props require a cast
            component={Link as any}
            to="/t/$tenant/notifications"
            params={{ tenant: tenantSlug }}
            size="xs"
            onClick={onClose}
            data-testid="inbox-dropdown-open-inbox"
          >
            <Group gap={4} align="center" wrap="nowrap">
              <span>Open inbox</span>
              <IconExternalLink size={12} />
            </Group>
          </Anchor>
        </Group>
      </Group>

      <Divider />

      {/* Filter controls */}
      <Stack gap="xs" px="sm" py="xs">
        <Chip.Group
          multiple
          value={selectedBuckets}
          onChange={(v: string[]) => {
            setSelectedBuckets(v);
          }}
        >
          <Group gap="xs" wrap="wrap">
            {FILTER_BUCKETS.map((b) => (
              <Chip
                key={b.value}
                value={b.value}
                size="xs"
                variant="light"
                data-testid={`inbox-filter-chip-${b.value}`}
              >
                {b.label}
              </Chip>
            ))}
          </Group>
        </Chip.Group>
        <Switch
          checked={showArchived}
          onChange={(e) => {
            setShowArchived(e.currentTarget.checked);
          }}
          label="Show archived"
          size="xs"
          data-testid="inbox-show-archived"
        />
      </Stack>

      <Divider />

      {/* List body */}
      <ScrollArea.Autosize mah={500} type="auto">
        {rows.length === 0 ? (
          <Stack align="center" gap="xs" py="xl" px="md">
            <IconBell size={32} color="var(--mantine-color-gray-5)" aria-hidden />
            <Text size="sm" fw={500}>
              No notifications
            </Text>
            <Text size="xs" c="var(--mantine-color-gray-7)">
              You&apos;re all caught up.
            </Text>
          </Stack>
        ) : (
          <Stack gap={0} data-testid="inbox-dropdown-list">
            {grouped.map((group) => (
              <Box key={group.category}>
                <Text
                  size="xs"
                  tt="uppercase"
                  fw={600}
                  c="var(--mantine-color-gray-7)"
                  px="sm"
                  py={6}
                  data-testid={`inbox-group-${group.category}`}
                >
                  {formatCategoryLabel(group.category)}
                </Text>
                {group.items.map((item) => (
                  <NotificationRow
                    key={item.id}
                    item={item}
                    canManageOwn={canManageOwn}
                    onMarkRead={handleMarkRead}
                    onArchive={handleArchive}
                    onAction={onClose}
                  />
                ))}
                <Divider />
              </Box>
            ))}
          </Stack>
        )}
      </ScrollArea.Autosize>
    </Stack>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────────

interface NotificationRowProps {
  item: NotificationItem;
  canManageOwn: boolean;
  onMarkRead: (id: ID) => void | Promise<void>;
  onArchive: (id: ID) => void | Promise<void>;
  onAction: () => void;
}

function NotificationRow({
  item,
  canManageOwn,
  onMarkRead,
  onArchive,
  onAction,
}: NotificationRowProps) {
  const Icon = SEVERITY_ICON[item.severity];
  const color = SEVERITY_COLOR[item.severity];
  const unread = item.read_at === null;
  const absolute = dayjs(item.at).format('YYYY-MM-DD HH:mm:ss');

  return (
    <Box
      px="sm"
      py="xs"
      style={{
        backgroundColor: unread
          ? 'var(--mantine-color-blue-0)'
          : 'transparent',
      }}
      data-testid={`inbox-row-${item.id}`}
    >
      <Group gap="sm" wrap="nowrap" align="flex-start">
        <Icon
          size={18}
          color={`var(--mantine-color-${color}-6)`}
          aria-label={`${item.severity} severity`}
          role="img"
        />
        <Stack gap={2} flex={1} miw={0}>
          <Group justify="space-between" gap="xs" wrap="nowrap">
            <Text
              size="sm"
              fw={unread ? 700 : 500}
              lineClamp={1}
              data-testid={`inbox-row-title-${item.id}`}
            >
              {item.title}
            </Text>
            <Tooltip label={absolute} withArrow>
              <Text
                size="xs"
                c="var(--mantine-color-gray-7)"
                style={{ flexShrink: 0 }}
              >
                {dayjs(item.at).fromNow()}
              </Text>
            </Tooltip>
          </Group>
          <Text size="xs" lineClamp={2} c="var(--mantine-color-gray-8)">
            {item.body}
          </Text>
          <Group gap="xs" mt={4}>
            {item.action && (
              <Anchor
                href={item.action.href}
                size="xs"
                onClick={onAction}
                data-testid={`inbox-row-action-${item.id}`}
              >
                {item.action.label}
              </Anchor>
            )}
            {unread && (
              <Badge size="xs" variant="dot" color="blue">
                New
              </Badge>
            )}
          </Group>
        </Stack>
        <Group gap={4} wrap="nowrap">
          {unread && (
            <Tooltip label="Mark as read" withArrow>
              <ActionIcon
                size="sm"
                variant="subtle"
                aria-label={`Mark "${item.title}" as read`}
                onClick={() => {
                  void onMarkRead(item.id);
                }}
                disabled={!canManageOwn}
                data-testid={`inbox-row-mark-read-${item.id}`}
              >
                <IconCheck size={14} />
              </ActionIcon>
            </Tooltip>
          )}
          {item.archived_at === null && (
            <Tooltip label="Archive" withArrow>
              <ActionIcon
                size="sm"
                variant="subtle"
                aria-label={`Archive "${item.title}"`}
                onClick={() => {
                  void onArchive(item.id);
                }}
                disabled={!canManageOwn}
                data-testid={`inbox-row-archive-${item.id}`}
              >
                <IconArchive size={14} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
      </Group>
    </Box>
  );
}
