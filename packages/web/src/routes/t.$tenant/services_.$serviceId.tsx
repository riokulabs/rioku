/**
 * Per-service detail page — /t/$tenant/services/$serviceId
 *
 * The trailing underscore on `services_` in the filename is the TanStack
 * Router flat-route convention — it lets us declare a sibling detail URL
 * without turning the list page `services.tsx` into a layout with <Outlet>.
 * The URL path emitted is still `/t/$tenant/services/$serviceId`.
 *
 * Used as the deep-link target from Sites' "Advanced configuration" button.
 * Renders the same <ServiceDetail> UI used in the services list drawer, with
 * route-level navigation (back button, full-screen layout).
 */
import { useState } from 'react';
import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { Alert, Button, Group, Stack, Title } from '@mantine/core';
import { IconAlertCircle, IconArrowLeft } from '@tabler/icons-react';
import { useMockStore } from '@/api/mock-store';
import { requirePermissions } from '@/hooks/use-before-load';
import { notify } from '@/hooks/use-notify';
import {
  ServiceDetail,
  ServiceForm,
  useServiceDetail,
} from '@/features/services';
import type { Route as RouteRecord } from '@/features/routes/types';

function ServiceDetailPage() {
  const { tenant, serviceId } = Route.useParams();
  const navigate = useNavigate();

  const tenantRecord = useMockStore((s) =>
    Object.values(s.tenants).find((t) => t.slug === tenant),
  );
  const tenantId = tenantRecord?.id ?? '';
  const tenantSlug = tenantRecord?.slug ?? tenant;

  const service = useServiceDetail(serviceId);
  const [editing, setEditing] = useState(false);

  const handleSelectRoute = (_r: RouteRecord) => {
    // Future: open per-route detail page when 2b.14b lands.
  };
  const handleEditRoute = (_r: RouteRecord) => {
    void navigate({
      to: '/t/$tenant/routes',
      params: { tenant: tenantSlug },
    } as unknown as Parameters<typeof navigate>[0]);
  };
  const handleDeleteRoute = (_r: RouteRecord) => {
    // noop — delete handled on /routes page
  };

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between" align="center">
        <Group gap="xs">
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
          <Title order={2}>{service ? service.name : 'Service detail'}</Title>
        </Group>
      </Group>

      {!service && (
        <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
          Service not found or not accessible in this tenant.
        </Alert>
      )}

      {service && !editing && (
        <ServiceDetail
          serviceId={service.id}
          tenantId={tenantId}
          onEdit={() => {
            setEditing(true);
          }}
          onSelectRoute={handleSelectRoute}
          onEditRoute={handleEditRoute}
          onDeleteRoute={handleDeleteRoute}
          onClose={() => {
            void navigate({
              to: '/t/$tenant/services',
              params: { tenant: tenantSlug },
            } as unknown as Parameters<typeof navigate>[0]);
          }}
        />
      )}

      {service && editing && (
        <ServiceForm
          mode="edit"
          tenantId={tenantId}
          initialValues={service}
          onSuccess={(svc) => {
            notify.success('Service saved', `${svc.name} updated.`);
            setEditing(false);
          }}
          onCancel={() => {
            setEditing(false);
          }}
        />
      )}
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/services_/$serviceId')({
  beforeLoad: requirePermissions({
    required: ['service:read', 'route:read'],
  }),
  component: ServiceDetailPage,
});
