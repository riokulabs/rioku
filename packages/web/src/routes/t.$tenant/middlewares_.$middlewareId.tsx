/**
 * Per-middleware full-page detail — /t/$tenant/middlewares/$middlewareId
 *
 * The trailing underscore on `middlewares_` in the filename is the TanStack
 * Router flat-route convention — sibling detail URL without turning the list
 * page into a layout with <Outlet>.
 *
 * Renders <MiddlewareFullPage> with tabs: Config / Bound routes / Audit.
 * Used as the deep-link target from the middleware drawer's "Open full page".
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { Button, Group, Stack } from '@mantine/core';
import { IconArrowLeft } from '@tabler/icons-react';
import { requirePermissions } from '@/hooks/use-before-load';
import { MiddlewareFullPage } from '@/features/middlewares/components/full-page';

function MiddlewareDetailPage() {
  const { tenant, middlewareId } = Route.useParams();

  const tenantId = tenant ?? '';
  const tenantSlug = tenant ?? '';

  return (
    <Stack gap="md" p="md">
      <Group>
        <Button
          variant="subtle"
          size="xs"
          leftSection={<IconArrowLeft size={14} />}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
          component={Link as any}
          to="/t/$tenant/middlewares"
          params={{ tenant: tenantSlug }}
        >
          Back to middlewares
        </Button>
      </Group>
      <MiddlewareFullPage
        middlewareId={middlewareId}
        tenantId={tenantId}
        tenantSlug={tenantSlug}
      />
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/middlewares_/$middlewareId')({
  beforeLoad: requirePermissions({ required: ['middleware:read'] }),
  component: MiddlewareDetailPage,
});
