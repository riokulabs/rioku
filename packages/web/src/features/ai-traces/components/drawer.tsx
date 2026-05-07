/**
 * <TraceDrawer> — quick-info drawer for an AI trace plus a
 * "Open full page" affordance that links to /t/$tenant/ai/traces/$traceId.
 *
 * Use this from the list page so most operators get the quick view
 * inline, while deep-link / shareable URLs route through the full
 * page.
 */
import { Button, Drawer, Group, Stack } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { IconExternalLink } from '@tabler/icons-react';
import { TraceDetail } from './detail';

interface TraceDrawerProps {
  opened: boolean;
  onClose: () => void;
  /** Trace id to display; empty/undefined leaves the drawer empty. */
  traceId: string | null;
  tenantSlug: string;
}

export function TraceDrawer({ opened, onClose, traceId, tenantSlug }: TraceDrawerProps) {
  return (
    <Drawer
      transitionProps={{ duration: 0 }}
      opened={opened}
      onClose={onClose}
      title={traceId !== null && traceId !== '' ? `Trace · ${traceId}` : 'Trace detail'}
      position="right"
      size="min(560px, 95vw)"
      padding="md"
      data-testid="trace-drawer"
    >
      {traceId !== null && traceId !== '' ? (
        <Stack gap="md">
          <Group justify="flex-end">
            <Button
              // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment -- TanStack Link polymorphic cast
              component={Link as any}
              to="/t/$tenant/ai/traces/$traceId"
              params={{ tenant: tenantSlug, traceId }}
              size="xs"
              variant="light"
              rightSection={<IconExternalLink size={12} />}
              data-testid="trace-drawer-open-full"
            >
              Open full page
            </Button>
          </Group>
          <TraceDetail traceId={traceId} tenantSlug={tenantSlug} onClose={onClose} />
        </Stack>
      ) : null}
    </Drawer>
  );
}
