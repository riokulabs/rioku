import {
  Group,
  Title,
  TextInput,
  ActionIcon,
  Kbd,
  Flex,
  Box,
  Indicator,
  Popover,
  Burger,
  Tooltip,
} from '@mantine/core';
import { IconSearch, IconBell } from '@tabler/icons-react';
import { RiokuLogo } from '@/components/rioku-logo';
import { spotlight } from '@mantine/spotlight';
import { useDisclosure } from '@mantine/hooks';
import { useMockStore } from '@/api/mock-store';
import { InboxDropdown } from '@/features/notifications/components/inbox-dropdown';
import { useUnreadCount } from '@/features/notifications/api';

/**
 * <TopBar> — workspace top bar.
 *
 * Hosts the branding + global spotlight launcher + notifications bell. The
 * bell renders a Mantine <Indicator> showing unread count (capped to "99+"
 * for display, hidden at zero) and opens the <InboxDropdown> in a Popover.
 *
 * Unread count is read via `useUnreadCount(currentUserId)`, which is backed
 * by a Zustand selector — it re-renders on any store mutation to the
 * `notifications` map, including live-emitted items written by
 * `emitNotification` / `host.notify`. No additional stream subscription is
 * needed here.
 */
interface TopBarProps {
  /** Controls the mobile nav burger state. Omitted on AdminLayout (no burger). */
  navOpened?: boolean;
  onNavToggle?: () => void;
}

export function TopBar({ navOpened, onNavToggle }: TopBarProps) {
  const currentUserId = useMockStore((s) => s.currentUserId);
  const unread = useUnreadCount(currentUserId ?? '');
  const [opened, { toggle, close }] = useDisclosure(false);

  // Cap display at "99+" to keep the badge visually compact when a user has
  // a flood of unread notifications. Aria label on the button carries the
  // exact count so screen readers announce it precisely; the Indicator's
  // inline label is then read as additional context — screen-reader output
  // is slightly redundant but never incorrect. We intentionally do not set
  // aria-hidden on the Indicator: axe correctly flags that as a serious
  // violation when the hidden container holds a focusable ActionIcon.
  const displayCount = unread > 99 ? '99+' : String(unread);
  const ariaLabel =
    unread === 0 ? 'Notifications, no unread' : `Notifications, ${String(unread)} unread`;

  return (
    <Flex h={56} px="md" align="center" gap="md">
      {/* Mobile burger — only rendered when nav toggle is wired (AppLayout, not AdminLayout).
       * Desktop collapse moved into the sidebar rail (see <Sidebar>'s collapse toggle). */}
      {onNavToggle !== undefined && (
        <Burger
          opened={navOpened ?? false}
          onClick={onNavToggle}
          hiddenFrom="sm"
          size="sm"
          aria-label={navOpened ? 'Close navigation' : 'Open navigation'}
        />
      )}
      <Group gap="xs">
        <RiokuLogo size={22} />
        <Title order={4}>Rioku</Title>
      </Group>
      <Box flex={1} visibleFrom="sm" />
      <TextInput
        placeholder="Search or jump to…"
        leftSection={<IconSearch size={16} />}
        rightSection={<Kbd>⌘K</Kbd>}
        rightSectionWidth={60}
        style={{ width: '100%', maxWidth: 480 }}
        visibleFrom="sm"
        readOnly
        onClick={() => {
          spotlight.open();
        }}
      />
      {/* Mobile: icon-only search button that opens Spotlight */}
      <Tooltip label="Search" withArrow hiddenFrom="sm">
        <ActionIcon
          size="lg"
          variant="subtle"
          aria-label="Search"
          hiddenFrom="sm"
          onClick={() => {
            spotlight.open();
          }}
          data-testid="topbar-search-mobile"
        >
          <IconSearch size={18} />
        </ActionIcon>
      </Tooltip>
      <Box flex={1} visibleFrom="sm" />
      <Popover
        opened={opened}
        onChange={(v) => {
          if (!v) close();
        }}
        position="bottom-end"
        width={400}
        shadow="md"
        withArrow
        trapFocus
      >
        {/*
         * Popover.Target must wrap the focusable element directly so that
         * Mantine can attach `aria-haspopup` + `aria-expanded` to a button.
         * Putting Indicator between Popover.Target and ActionIcon places
         * those attributes on a non-interactive <div>, which axe flags as
         * `aria-allowed-attr` (critical). We wrap the Indicator around the
         * whole Popover.Target instead — the Indicator is purely visual
         * chrome and its outer <div> does not need ARIA state.
         */}
        <Indicator
          label={displayCount}
          size={16}
          color="red"
          disabled={unread === 0}
          offset={4}
          withBorder
        >
          <Popover.Target>
            <ActionIcon
              size="lg"
              variant="subtle"
              aria-label={ariaLabel}
              onClick={toggle}
              data-testid="topbar-bell"
            >
              <IconBell size={18} />
            </ActionIcon>
          </Popover.Target>
        </Indicator>
        <Popover.Dropdown p={0} data-testid="topbar-bell-dropdown">
          {currentUserId !== null && <InboxDropdown userId={currentUserId} onClose={close} />}
        </Popover.Dropdown>
      </Popover>
    </Flex>
  );
}
