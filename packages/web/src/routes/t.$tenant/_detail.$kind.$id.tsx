/**
 * Generic full-page detail route — /t/$tenant/_detail/$kind/$id
 *
 * Stage-1 implementation: renders detail content for a small set of known
 * entity kinds inside a full-width page frame.  Unknown kinds show a "coming
 * soon" stub.  The underscore prefix on `_detail` in the filename is the
 * TanStack Router flat-route convention to prevent the segment from acting as
 * a layout: the emitted URL path is still `/t/$tenant/_detail/$kind/$id`.
 *
 * Registry (stage 1):
 *   service → ServiceDetailPage (reuses services_.$serviceId logic)
 *   route   → RouteDetailPage
 *   user    → UserDetailPage
 *   *       → StubPage
 */
import { useState } from 'react';
import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { Alert, Button, Group, Stack, Text, Title } from '@mantine/core';
import { IconAlertCircle, IconArrowLeft } from '@tabler/icons-react';
import { useMockStore } from '@/api/mock-store';
import { requirePermissions } from '@/hooks/use-before-load';
import { notify } from '@/hooks/use-notify';

// ── Service ──────────────────────────────────────────────────────────────────
import { ServiceDetail, ServiceForm, useServiceDetail } from '@/features/services';
import type { Route as RouteRecord } from '@/features/routes/types';

function ServiceDetailPage({
  entityId,
  tenantId,
  tenantSlug,
}: {
  entityId: string;
  tenantId: string;
  tenantSlug: string;
}) {
  const navigate = useNavigate();
  const service = useServiceDetail(entityId);
  const [editing, setEditing] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const handleSelectRoute = (_r: RouteRecord) => {};
  const handleEditRoute = (_r: RouteRecord) => {
    void navigate({
      to: '/t/$tenant/routes',
      params: { tenant: tenantSlug },
    } as unknown as Parameters<typeof navigate>[0]);
  };
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const handleDeleteRoute = (_r: RouteRecord) => {};

  if (!service) {
    return (
      <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
        Service not found.
      </Alert>
    );
  }

  return (
    <>
      {!editing && (
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
      {editing && (
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
    </>
  );
}

// ── Route ────────────────────────────────────────────────────────────────────
import { RouteDetail, RouteForm, useRouteDetail } from '@/features/routes';

function RouteDetailPage({
  entityId,
  tenantId,
  tenantSlug,
}: {
  entityId: string;
  tenantId: string;
  tenantSlug: string;
}) {
  const navigate = useNavigate();
  const route = useRouteDetail(entityId);
  const [editing, setEditing] = useState(false);

  if (!route) {
    return (
      <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
        Route not found.
      </Alert>
    );
  }

  return (
    <>
      {!editing && (
        <RouteDetail
          routeId={route.id}
          tenantId={tenantId}
          onEdit={() => {
            setEditing(true);
          }}
          onClose={() => {
            void navigate({
              to: '/t/$tenant/routes',
              params: { tenant: tenantSlug },
            } as unknown as Parameters<typeof navigate>[0]);
          }}
        />
      )}
      {editing && (
        <RouteForm
          mode="edit"
          tenantId={tenantId}
          initialValues={route}
          onSuccess={(r) => {
            notify.success('Route saved', `${r.name} updated.`);
            setEditing(false);
          }}
          onCancel={() => {
            setEditing(false);
          }}
        />
      )}
    </>
  );
}

// ── User ─────────────────────────────────────────────────────────────────────
import { UserDetail } from '@/features/security/users';

function UserDetailPage({
  entityId,
  tenantId,
  tenantSlug,
}: {
  entityId: string;
  tenantId: string;
  tenantSlug: string;
}) {
  const navigate = useNavigate();

  return (
    <UserDetail
      userId={entityId}
      currentTenantId={tenantId}
      tenantSlug={tenantSlug}
      onClose={() => {
        void navigate({
          to: '/t/$tenant/security/users',
          params: { tenant: tenantSlug },
        } as unknown as Parameters<typeof navigate>[0]);
      }}
    />
  );
}

// ── Stub ─────────────────────────────────────────────────────────────────────
function StubPage({ kind }: { kind: string }) {
  return (
    <Alert color="blue" variant="light" icon={<IconAlertCircle size={16} />}>
      <Text size="sm">
        Full page mode coming soon for{' '}
        <Text component="span" fw={600} ff="monospace">
          {kind}
        </Text>
        .
      </Text>
    </Alert>
  );
}

// ── Registry ─────────────────────────────────────────────────────────────────
type DetailRenderer = React.ComponentType<{
  entityId: string;
  tenantId: string;
  tenantSlug: string;
}>;

const DETAIL_REGISTRY: Record<string, DetailRenderer> = {
  service: ServiceDetailPage,
  route: RouteDetailPage,
  user: UserDetailPage,
};

// ── Page ─────────────────────────────────────────────────────────────────────
function DetailPage() {
  const { tenant, kind, id } = Route.useParams();

  const tenantRecord = useMockStore((s) => Object.values(s.tenants).find((t) => t.slug === tenant));
  const tenantId = tenantRecord?.id ?? '';
  const tenantSlug = tenantRecord?.slug ?? tenant;

  const DetailComponent = DETAIL_REGISTRY[kind];

  const backLabel =
    kind === 'service'
      ? 'Back to services'
      : kind === 'route'
        ? 'Back to routes'
        : kind === 'user'
          ? 'Back to users'
          : 'Back';

  const backTo =
    kind === 'service'
      ? '/t/$tenant/services'
      : kind === 'route'
        ? '/t/$tenant/routes'
        : kind === 'user'
          ? '/t/$tenant/security/users'
          : '/t/$tenant/dashboard';

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between" align="center">
        <Button
          variant="subtle"
          size="xs"
          leftSection={<IconArrowLeft size={14} />}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
          component={Link as any}
          to={backTo}
          params={{ tenant: tenantSlug }}
        >
          {backLabel}
        </Button>
        <Title order={2} style={{ textTransform: 'capitalize' }}>
          {kind} detail
        </Title>
      </Group>

      {DetailComponent ? (
        <DetailComponent entityId={id} tenantId={tenantId} tenantSlug={tenantSlug} />
      ) : (
        <StubPage kind={kind} />
      )}
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/_detail/$kind/$id')({
  beforeLoad: requirePermissions({ required: [] }),
  component: DetailPage,
});
