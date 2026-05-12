/**
 * <MiddlewareDrawer> — quick-info drawer body for a middleware.
 *
 * Renders a compact summary (name, kind badge, enabled toggle, JSON config
 * preview) with an "Open full page" button that navigates to
 * `/t/$tenant/api-mgmt/middlewares/$middlewareId`. Used as the right-side
 * drawer body on the middlewares list page (per RD5).
 */
import { Badge, Button, Code, Divider, Group, Stack, Switch, Text, Title } from '@mantine/core';
import { IconArrowRight, IconStack } from '@tabler/icons-react';
import { Link } from '@tanstack/react-router';
import { useMiddlewareDetail } from '../api';

const KIND_COLORS: Record<string, string> = {
  'rate-limit': 'cyan',
  auth: 'red',
  transform: 'violet',
  cors: 'orange',
  cache: 'green',
  logging: 'gray',
  custom: 'grape',
};

export interface MiddlewareDrawerProps {
  /** Middleware id to show. */
  middlewareId: string;
  /** Tenant slug used for the "Open full page" deep link. */
  tenantSlug: string;
}

export function MiddlewareDrawer({ middlewareId, tenantSlug }: MiddlewareDrawerProps) {
  const middleware = useMiddlewareDetail(tenantSlug, middlewareId);

  if (!middleware) {
    return (
      <Stack gap="sm" data-testid="middleware-drawer-empty">
        <Text size="sm" c="var(--mantine-color-gray-7)">
          Middleware not found.
        </Text>
      </Stack>
    );
  }

  const configPreview = JSON.stringify(middleware.config, null, 2);

  return (
    <Stack gap="md" data-testid="middleware-drawer">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Group gap="sm" wrap="nowrap">
          <IconStack size={22} color="var(--mantine-color-violet-6)" />
          <Stack gap={2}>
            <Title order={5}>{middleware.name}</Title>
            <Group gap="xs">
              <Badge size="sm" variant="light" color={KIND_COLORS[middleware.kind] ?? 'gray'}>
                {middleware.kind}
              </Badge>
              <Badge size="sm" variant="light" color={middleware.enabled ? 'green' : 'gray'}>
                {middleware.enabled ? 'enabled' : 'disabled'}
              </Badge>
            </Group>
          </Stack>
        </Group>
        <Switch
          checked={middleware.enabled}
          readOnly
          aria-label={`Enabled state for ${middleware.name}`}
        />
      </Group>

      {middleware.description && (
        <Text size="sm" c="var(--mantine-color-gray-7)">
          {middleware.description}
        </Text>
      )}

      <Divider label="Config preview" labelPosition="left" />
      <Code
        block
        data-testid="middleware-drawer-config"
        style={{ maxHeight: 220, overflow: 'auto', fontSize: 12 }}
      >
        {configPreview}
      </Code>

      <Group justify="flex-end">
        <Button
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
          component={Link as any}
          to="/t/$tenant/api-mgmt/middlewares/$middlewareId"
          params={{ tenant: tenantSlug, middlewareId: middleware.id }}
          rightSection={<IconArrowRight size={14} />}
          size="sm"
          data-testid="middleware-drawer-open-full-page"
        >
          Open full page
        </Button>
      </Group>
    </Stack>
  );
}
