/**
 * <ServiceDrawer> — quick info panel surfaced from the services list.
 *
 * Stage 2 wiring: pulls the service via `useServiceDetail` (real endpoint
 * via `useServiceDetailReal` under the hood). Acts as a lightweight peek
 * with a single primary action — "Open full page" — that deep-links into
 * `<ServiceFullPage>` on a dedicated route.
 *
 * The richer Drawer view (with edit/delete/etc.) lives in
 * `components/detail.tsx` and is rendered from the existing services list
 * page. This component is intentionally minimal so the list "row click"
 * interaction stays fast and the full-page route remains the canonical
 * deep-linkable surface.
 */
import { Alert, Badge, Button, Group, Stack, Text } from '@mantine/core';
import { IconAlertCircle, IconExternalLink, IconServer } from '@tabler/icons-react';
import { HealthChip, ProtocolBadge } from '@/features/api-mgmt-shared';
import { useServiceDetail } from '../api';

export interface ServiceDrawerProps {
  serviceId: string;
  tenantId: string;
  /** Invoked when the user clicks the "Open full page" CTA. */
  onOpenFullPage: (serviceId: string) => void;
}

export function ServiceDrawer({ serviceId, tenantId, onOpenFullPage }: ServiceDrawerProps) {
  const service = useServiceDetail(tenantId, serviceId);

  if (!service) {
    return (
      <Alert
        color="red"
        variant="light"
        icon={<IconAlertCircle size={16} />}
        data-testid="service-drawer-not-found"
      >
        Service not found.
      </Alert>
    );
  }

  return (
    <Stack gap="md" data-testid="service-drawer">
      <Group gap="sm" align="flex-start" wrap="nowrap">
        <IconServer size={24} color="var(--mantine-color-blue-6)" />
        <Stack gap={4}>
          <Group gap="xs" align="center">
            <Text fw={600} ff="monospace">
              {service.name}
            </Text>
            <HealthChip status={service.health} />
            <Badge size="sm" variant="outline" color="blue">
              {service.env}
            </Badge>
          </Group>
          {service.description && (
            <Text size="sm" c="var(--mantine-color-gray-7)">
              {service.description}
            </Text>
          )}
        </Stack>
      </Group>

      <Stack gap={4}>
        <Text size="xs" c="var(--mantine-color-gray-7)" tt="uppercase">
          Upstream
        </Text>
        <Group gap="xs" align="center">
          <ProtocolBadge kind={service.upstream_protocol} />
          <Text size="sm" ff="monospace">
            {service.upstream}
          </Text>
        </Group>
      </Stack>

      {service.tags.length > 0 && (
        <Stack gap={4}>
          <Text size="xs" c="var(--mantine-color-gray-7)" tt="uppercase">
            Tags
          </Text>
          <Group gap={4}>
            {service.tags.map((t) => (
              <Badge key={t} size="xs" variant="light" color="gray">
                {t}
              </Badge>
            ))}
          </Group>
        </Stack>
      )}

      <Group justify="flex-end">
        <Button
          size="sm"
          rightSection={<IconExternalLink size={14} />}
          onClick={() => {
            onOpenFullPage(service.id);
          }}
          data-testid="service-drawer-open-full-page"
        >
          Open full page
        </Button>
      </Group>
    </Stack>
  );
}
