/**
 * Per-service detail page — /t/$tenant/services/$serviceId
 *
 * The trailing underscore on `services_` in the filename is the TanStack
 * Router flat-route convention — it lets us declare a sibling detail URL
 * without turning the list page `services.tsx` into a layout with <Outlet>.
 * The URL path emitted is still `/t/$tenant/services/$serviceId`.
 *
 * Renders the Stage 2 <ServiceFullPage> component (Overview / Routes /
 * Health / Audit tabs) backed by real daemon endpoints.
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { Button, Group, Stack } from '@mantine/core';
import { IconArrowLeft } from '@tabler/icons-react';
import { useMockStore } from '@/api/mock-store';
import { requirePermissions } from '@/hooks/use-before-load';
import { ServiceFullPage } from '@/features/services/components/full-page';

function ServiceDetailPage() {
  const { tenant, serviceId } = Route.useParams();

  const tenantRecord = useMockStore((s) => Object.values(s.tenants).find((t) => t.slug === tenant));
  const tenantId = tenantRecord?.id ?? '';
  const tenantSlug = tenantRecord?.slug ?? tenant;

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between" align="center">
        <Button
          variant="subtle"
          size="xs"
          leftSection={<IconArrowLeft size={14} />}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
          component={Link as any}
          to="/t/$tenant/services"
          params={{ tenant: tenantSlug }}
        >
          Back to services
        </Button>
      </Group>

      <ServiceFullPage serviceId={serviceId} tenantId={tenantId} />
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/services_/$serviceId')({
  beforeLoad: requirePermissions({
    required: ['service:read', 'route:read'],
  }),
  component: ServiceDetailPage,
});
