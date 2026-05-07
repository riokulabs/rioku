/**
 * Per-route detail page — /t/$tenant/routes/$routeId
 *
 * TanStack Router flat-route convention: trailing `_` lets us declare a
 * sibling detail URL without turning the list page `routes.tsx` into a
 * layout. URL path emitted: `/t/$tenant/routes/$routeId`.
 *
 * Renders the Stage 2 <RouteFullPage> component (Overview / Middlewares /
 * Policies / Audit tabs). Component itself reads the route via the real
 * Stage-2 endpoint.
 */
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Button, Group, Stack } from '@mantine/core';
import { IconArrowLeft } from '@tabler/icons-react';
import { requirePermissions } from '@/hooks/use-before-load';
import { RouteFullPage } from '@/features/routes/components/full-page';

function RouteDetailPage() {
  const { tenant, routeId } = Route.useParams();
  const navigate = useNavigate();

  const tenantId = tenant;
  const tenantSlug = tenant;

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between" align="center">
        <Button
          variant="subtle"
          size="xs"
          leftSection={<IconArrowLeft size={14} />}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
          component={Link as any}
          to="/t/$tenant/routes"
          params={{ tenant: tenantSlug }}
        >
          Back to routes
        </Button>
      </Group>

      <RouteFullPage
        routeId={routeId}
        tenantId={tenantId}
        onBack={() =>
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
          void navigate({ to: '/t/$tenant/routes', params: { tenant: tenantSlug } } as any)
        }
      />
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/routes_/$routeId')({
  beforeLoad: requirePermissions({
    required: ['route:read'],
  }),
  component: RouteDetailPage,
});
