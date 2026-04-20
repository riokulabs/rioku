/**
 * Notifications inbox page — /t/$tenant/notifications
 *
 * Permission guard: `notification:read`.
 *
 * Shape:
 *   Header (title + count + "Mark all read" + unread count badge)
 *   <NotificationFilterBar>
 *   <NotificationList>
 *   <Drawer><NotificationDetail /></Drawer>
 *
 * URL-synced filter — category + severity as CSV, search as string, read
 * state as a single token (all / unread / read), archived as bool, selected
 * id for drawer restoration on back/forward.
 */
import { useCallback, useMemo } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import {
  Badge,
  Button,
  Drawer,
  Group,
  Stack,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useMockStore } from '@/api/mock-store';
import { notify } from '@/hooks/use-notify';
import { usePermission } from '@/hooks/use-permission';
import { requirePermissions } from '@/hooks/use-before-load';
import {
  NotificationDetail,
  NotificationFilterBar,
  NotificationList,
  markAllRead,
  useNotificationList,
  useUnreadCount,
  type InboxFilter,
  type NotificationItem,
  type ReadFilter,
} from '@/features/notifications';

// ─── Search params ───────────────────────────────────────────────────────────

interface SearchParams {
  categories: string[];
  severities: NotificationItem['severity'][];
  search: string;
  read: ReadFilter;
  archived: boolean;
  selected?: string;
}

const SEVERITY_VALUES: readonly NotificationItem['severity'][] = [
  'info',
  'warn',
  'error',
  'success',
];

const READ_VALUES: readonly ReadFilter[] = ['all', 'unread', 'read'];

function parseCsv(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.filter((x): x is string => typeof x === 'string' && x.length > 0);
  }
  if (typeof v !== 'string' || v.length === 0) return [];
  return v
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseSeverities(v: unknown): NotificationItem['severity'][] {
  return parseCsv(v).filter((x): x is NotificationItem['severity'] =>
    (SEVERITY_VALUES as readonly string[]).includes(x),
  );
}

function parseRead(v: unknown): ReadFilter {
  if (typeof v === 'string' && (READ_VALUES as readonly string[]).includes(v)) {
    return v as ReadFilter;
  }
  return 'all';
}

function parseBool(v: unknown): boolean {
  return v === true || v === 'true' || v === '1';
}

// ─── Page component ──────────────────────────────────────────────────────────

function NotificationsPage() {
  const search = Route.useSearch();
  const { tenant } = Route.useParams();
  const navigate = useNavigate();

  const currentUserId = useMockStore((s) => s.currentUserId) ?? '';
  const tenantRecord = useMockStore((s) =>
    Object.values(s.tenants).find((t) => t.slug === tenant),
  );
  const tenantSlug = tenantRecord?.slug ?? tenant;

  const canManageOwn = usePermission('notification:manage-own');

  const filter = useMemo<InboxFilter>(
    () => ({
      categories: search.categories,
      severities: search.severities,
      unreadOnly: search.read === 'unread',
      includeArchived: search.archived,
      search: search.search,
    }),
    [search.categories, search.severities, search.read, search.archived, search.search],
  );

  const rows = useNotificationList(currentUserId, filter);

  // "Read" filter variant — when the read segmented is "read" we need to
  // exclude unread entries. `useNotificationList` natively handles the
  // unreadOnly case, but not the inverse. We post-filter client-side here
  // to keep the hook API simple.
  const visibleRows = useMemo(() => {
    if (search.read === 'read') {
      return rows.filter((r) => r.read_at !== null);
    }
    return rows;
  }, [rows, search.read]);

  // Unfiltered list for populating the filter bar's category options (so
  // plugin categories are discoverable even when the user hasn't typed them).
  const allNotifications = useNotificationList(currentUserId, {
    categories: [],
    severities: [],
    unreadOnly: false,
    includeArchived: true,
    search: '',
  });

  const unreadCount = useUnreadCount(currentUserId);

  const [drawerOpened, { open: openDrawer, close: closeDrawer }] =
    useDisclosure(Boolean(search.selected));
  const selectedItem = useMemo<NotificationItem | null>(() => {
    if (!search.selected) return null;
    // Detail drawer should resolve against ALL notifications, not just the
    // current filter — otherwise archiving or filtering away the selected
    // item closes the drawer abruptly.
    return allNotifications.find((n) => n.id === search.selected) ?? null;
  }, [allNotifications, search.selected]);

  const updateSearch = useCallback(
    (mutate: (prev: Record<string, unknown>) => Record<string, unknown>) => {
      void navigate({
        to: '/t/$tenant/notifications',
        params: { tenant: tenantSlug },
        search: mutate,
        replace: true,
      } as unknown as Parameters<typeof navigate>[0]);
    },
    [navigate, tenantSlug],
  );

  const handleFilterChange = useCallback(
    (next: InboxFilter, readFilter: ReadFilter) => {
      updateSearch(() => ({
        categories: next.categories.join(','),
        severities: next.severities.join(','),
        search: next.search,
        read: readFilter,
        archived: next.includeArchived ? 'true' : 'false',
      }));
    },
    [updateSearch],
  );

  const handleRowSelect = useCallback(
    (item: NotificationItem) => {
      updateSearch((prev) => ({ ...prev, selected: item.id }));
      openDrawer();
    },
    [openDrawer, updateSearch],
  );

  const handleDrawerClose = useCallback(() => {
    closeDrawer();
    updateSearch((prev) => ({ ...prev, selected: '' }));
  }, [closeDrawer, updateSearch]);

  async function handleMarkAll() {
    if (!canManageOwn) return;
    try {
      const n = await markAllRead(currentUserId);
      if (n > 0) {
        notify.success('All read', `Marked ${String(n)} notifications read.`);
      }
    } catch {
      notify.error('Mark all read failed', 'Please try again.');
    }
  }

  return (
    <Stack gap="md" p="md" data-testid="notifications-page">
      <Group justify="space-between" align="center">
        <Group gap="sm" align="center">
          <Title order={2}>Notifications</Title>
          <Badge variant="light" color="gray" size="sm">
            {String(visibleRows.length)} shown
          </Badge>
          {unreadCount > 0 && (
            <Badge variant="light" color="blue" size="sm">
              {String(unreadCount)} unread
            </Badge>
          )}
        </Group>
        <Group gap="sm">
          <Button
            variant="subtle"
            onClick={() => {
              void handleMarkAll();
            }}
            disabled={!canManageOwn || unreadCount === 0}
            data-testid="notifications-mark-all"
          >
            Mark all read
          </Button>
        </Group>
      </Group>

      <NotificationFilterBar
        filter={filter}
        readFilter={search.read}
        allNotifications={allNotifications}
        onChange={handleFilterChange}
      />

      <NotificationList rows={visibleRows} onSelect={handleRowSelect} />

      <Drawer
        opened={drawerOpened}
        onClose={handleDrawerClose}
        title={selectedItem ? `Notification · ${selectedItem.title}` : 'Notification'}
        position="right"
        size="xl"
        padding="md"
      >
        {selectedItem && (
          <NotificationDetail item={selectedItem} onClose={handleDrawerClose} />
        )}
      </Drawer>
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/notifications')({
  beforeLoad: requirePermissions({ required: ['notification:read'] }),
  component: NotificationsPage,
  validateSearch: (s: Record<string, unknown>): SearchParams => ({
    categories: parseCsv(s.categories),
    severities: parseSeverities(s.severities),
    search: typeof s.search === 'string' ? s.search : '',
    read: parseRead(s.read),
    archived: parseBool(s.archived),
    ...(typeof s.selected === 'string' && s.selected.length > 0
      ? { selected: s.selected }
      : {}),
  }),
});
