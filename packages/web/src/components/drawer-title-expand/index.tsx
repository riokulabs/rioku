/**
 * <DrawerTitleExpand> — drop-in Drawer title slot that prefixes an
 * "Open full page" icon button at the top-left of the drawer header,
 * mirroring Mantine's top-right close X.
 *
 * Usage:
 *   <Drawer
 *     title={<DrawerTitleExpand title="Service: foo" onOpenFullPage={handler} />}
 *     ...
 *   />
 *
 * When onOpenFullPage is undefined, renders the plain title (no icon).
 */
import { ActionIcon, Group, Text, Tooltip } from '@mantine/core';
import { IconArrowsDiagonal } from '@tabler/icons-react';
import type { ReactNode } from 'react';

export interface DrawerTitleExpandProps {
  /** Title content — a string renders as <Text fw={600}>; ReactNode renders as-is. */
  title: ReactNode;
  /** When provided, an expand icon appears at the left of the header. */
  onOpenFullPage?: () => void;
}

export function DrawerTitleExpand({ title, onOpenFullPage }: DrawerTitleExpandProps) {
  const titleNode = typeof title === 'string' ? <Text fw={600}>{title}</Text> : title;
  if (!onOpenFullPage) return titleNode;
  return (
    <Group gap="xs" wrap="nowrap" align="center">
      <Tooltip label="Open full page" withArrow position="right">
        <ActionIcon
          variant="subtle"
          size="sm"
          onClick={onOpenFullPage}
          aria-label="Open full page"
          data-testid="drawer-open-full-page"
        >
          <IconArrowsDiagonal size={16} />
        </ActionIcon>
      </Tooltip>
      {titleNode}
    </Group>
  );
}
