/**
 * Generic full-page detail route — /t/$tenant/_detail/$kind/$id
 *
 * Stage-1 implementation: renders detail content for every known entity
 * kind inside a full-width page frame with a kind-specific back button.
 * Drawer-style detail components are reused by adapter shims that map
 * `(entityId, tenantId, tenantSlug)` → the component's expected prop shape.
 *
 * Kinds wired up:
 *   service / route / user                  (legacy)
 *   agent / provider / tool / mcp-server    (AI)
 *   trace / rate-limit / middleware
 *   api-key / session / audit               (security)
 *   role / access-policy / rbac-policy
 *   plugin / notification
 *
 * Unknown kinds fall through to a friendly "this kind doesn't have a
 * full-page view yet" alert with a Back button.
 */
import { useState } from 'react';
import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { Alert, Button, Group, Stack, Text, Title } from '@mantine/core';
import { IconAlertCircle, IconArrowLeft } from '@tabler/icons-react';
import { useMockStore } from '@/api/mock-store';
import { requirePermissions } from '@/hooks/use-before-load';
import { notify } from '@/hooks/use-notify';

// ── Service / Route / User (legacy) ─────────────────────────────────────────
import { ServiceDetail, ServiceForm, useServiceDetail } from '@/features/services';
import type { Route as RouteRecord } from '@/features/routes/types';
import { RouteDetail, RouteForm, useRouteDetail } from '@/features/routes';
import { UserDetail } from '@/features/security/users';

// ── AI ──────────────────────────────────────────────────────────────────────
import { AgentDetail } from '@/features/ai-agents';
import { ProviderDetail } from '@/features/ai-providers';
import { ToolDetail } from '@/features/ai-tools';
import { McpServerDetail } from '@/features/ai-mcp-servers';
import { TraceDetail } from '@/features/ai-traces';
import { RateLimitDetail } from '@/features/ai-rate-limits';

// ── Routing primitives ──────────────────────────────────────────────────────
import { MiddlewareDetail } from '@/features/middlewares';

// ── Security ────────────────────────────────────────────────────────────────
import { ApiKeyDetailDrawer } from '@/features/security/api-keys/components/detail-drawer';
import { AuditDetail } from '@/features/audit';
import { RoleDetail, useRole } from '@/features/security/roles';
import { AccessPolicyDetail } from '@/features/security/access-policies';
import { RbacPolicyDetail, useRbacPolicy } from '@/features/security/rbac-policies';
import { useApiKey } from '@/features/security/api-keys/api';

// ── Plugins / Notifications ─────────────────────────────────────────────────
import { InstalledPluginDetail } from '@/features/plugins/installed';

// ─────────────────────────────────────────────────────────────────────────────

interface RendererProps {
  entityId: string;
  tenantId: string;
  tenantSlug: string;
}

type DetailRenderer = React.ComponentType<RendererProps>;

// Generic "not found" alert — used by every adapter when its lookup misses.
function NotFound({ what }: { what: string }) {
  return (
    <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
      {what} not found.
    </Alert>
  );
}

// ── Adapters ─────────────────────────────────────────────────────────────────

function ServiceDetailPage({ entityId, tenantId, tenantSlug }: RendererProps) {
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

  if (!service) return <NotFound what="Service" />;

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

function RouteDetailPage({ entityId, tenantId, tenantSlug }: RendererProps) {
  const navigate = useNavigate();
  const route = useRouteDetail(entityId);
  const [editing, setEditing] = useState(false);
  if (!route) return <NotFound what="Route" />;
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

function UserDetailPage({ entityId, tenantId, tenantSlug }: RendererProps) {
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

function AgentDetailPage({ entityId, tenantSlug }: RendererProps) {
  const navigate = useNavigate();
  return (
    <AgentDetail
      agentId={entityId}
      tenantSlug={tenantSlug}
      onEdit={() => {
        void navigate({
          to: '/t/$tenant/ai/agents',
          params: { tenant: tenantSlug },
          search: { selected: entityId },
        } as unknown as Parameters<typeof navigate>[0]);
      }}
      onClose={() => {
        void navigate({
          to: '/t/$tenant/ai/agents',
          params: { tenant: tenantSlug },
        } as unknown as Parameters<typeof navigate>[0]);
      }}
    />
  );
}

function ProviderDetailPage({ entityId, tenantSlug }: RendererProps) {
  const navigate = useNavigate();
  return (
    <ProviderDetail
      providerId={entityId}
      onEdit={() => {
        void navigate({
          to: '/t/$tenant/ai/providers',
          params: { tenant: tenantSlug },
          search: { selected: entityId },
        } as unknown as Parameters<typeof navigate>[0]);
      }}
      onClose={() => {
        void navigate({
          to: '/t/$tenant/ai/providers',
          params: { tenant: tenantSlug },
        } as unknown as Parameters<typeof navigate>[0]);
      }}
    />
  );
}

function ToolDetailPage({ entityId, tenantSlug }: RendererProps) {
  const navigate = useNavigate();
  return (
    <ToolDetail
      toolId={entityId}
      tenantSlug={tenantSlug}
      onEdit={() => {
        void navigate({
          to: '/t/$tenant/ai/tools',
          params: { tenant: tenantSlug },
          search: { selected: entityId },
        } as unknown as Parameters<typeof navigate>[0]);
      }}
      onClose={() => {
        void navigate({
          to: '/t/$tenant/ai/tools',
          params: { tenant: tenantSlug },
        } as unknown as Parameters<typeof navigate>[0]);
      }}
    />
  );
}

function McpServerDetailPage({ entityId, tenantSlug }: RendererProps) {
  const navigate = useNavigate();
  return (
    <McpServerDetail
      serverId={entityId}
      tenantSlug={tenantSlug}
      onEdit={() => {
        void navigate({
          to: '/t/$tenant/ai/mcp-servers',
          params: { tenant: tenantSlug },
          search: { selected: entityId },
        } as unknown as Parameters<typeof navigate>[0]);
      }}
      onClose={() => {
        void navigate({
          to: '/t/$tenant/ai/mcp-servers',
          params: { tenant: tenantSlug },
        } as unknown as Parameters<typeof navigate>[0]);
      }}
    />
  );
}

function TraceDetailPage({ entityId, tenantSlug }: RendererProps) {
  const navigate = useNavigate();
  return (
    <TraceDetail
      traceId={entityId}
      tenantSlug={tenantSlug}
      onClose={() => {
        void navigate({
          to: '/t/$tenant/ai/traces',
          params: { tenant: tenantSlug },
        } as unknown as Parameters<typeof navigate>[0]);
      }}
    />
  );
}

function RateLimitDetailPage({ entityId, tenantSlug }: RendererProps) {
  const navigate = useNavigate();
  return (
    <RateLimitDetail
      ruleId={entityId}
      onEdit={() => {
        void navigate({
          to: '/t/$tenant/ai/rate-limits',
          params: { tenant: tenantSlug },
        } as unknown as Parameters<typeof navigate>[0]);
      }}
      onClose={() => {
        void navigate({
          to: '/t/$tenant/ai/rate-limits',
          params: { tenant: tenantSlug },
        } as unknown as Parameters<typeof navigate>[0]);
      }}
    />
  );
}

function MiddlewareDetailPage({ entityId, tenantSlug }: RendererProps) {
  const navigate = useNavigate();
  return (
    <MiddlewareDetail
      middlewareId={entityId}
      onEdit={() => {
        void navigate({
          to: '/t/$tenant/middlewares',
          params: { tenant: tenantSlug },
        } as unknown as Parameters<typeof navigate>[0]);
      }}
      onClose={() => {
        void navigate({
          to: '/t/$tenant/middlewares',
          params: { tenant: tenantSlug },
        } as unknown as Parameters<typeof navigate>[0]);
      }}
    />
  );
}

function ApiKeyDetailPage({ entityId, tenantSlug }: RendererProps) {
  const navigate = useNavigate();
  const key = useApiKey(entityId);
  if (!key) return <NotFound what="API key" />;
  return (
    <ApiKeyDetailDrawer
      keyId={entityId}
      onClose={() => {
        void navigate({
          to: '/t/$tenant/security/api-keys',
          params: { tenant: tenantSlug },
        } as unknown as Parameters<typeof navigate>[0]);
      }}
    />
  );
}

/**
 * Sessions render inline (RD5) — there is no full-page detail. Direct
 * deep-links to /t/$tenant/_detail/session/$id render an explanation
 * alert with a "Back to sessions" button so old links don't 404.
 */
function SessionDetailPage({ tenantSlug }: RendererProps) {
  const navigate = useNavigate();
  return (
    <Alert color="blue" variant="light" icon={<IconAlertCircle size={16} />}>
      <Stack gap="sm">
        <Text size="sm">
          Sessions are shown inline on the sessions page. There is no full-page detail.
        </Text>
        <Group>
          <Button
            size="xs"
            variant="default"
            leftSection={<IconArrowLeft size={14} />}
            onClick={() => {
              void navigate({
                to: '/t/$tenant/security/sessions',
                params: { tenant: tenantSlug },
              } as unknown as Parameters<typeof navigate>[0]);
            }}
          >
            Back to sessions
          </Button>
        </Group>
      </Stack>
    </Alert>
  );
}

function AuditDetailPage({ entityId, tenantSlug }: RendererProps) {
  const navigate = useNavigate();
  const entry = useMockStore((s) => s.audit.find((e) => e.id === entityId) ?? null);
  if (!entry) return <NotFound what="Audit entry" />;
  return (
    <AuditDetail
      entry={entry}
      onClose={() => {
        void navigate({
          to: '/t/$tenant/security/audit',
          params: { tenant: tenantSlug },
        } as unknown as Parameters<typeof navigate>[0]);
      }}
    />
  );
}

function RoleDetailPage({ entityId, tenantSlug }: RendererProps) {
  const navigate = useNavigate();
  const role = useRole(tenantSlug, entityId);
  if (!role) return <NotFound what="Role" />;
  return (
    <RoleDetail
      tenant={tenantSlug}
      role={role}
      onClose={() => {
        void navigate({
          to: '/t/$tenant/security/roles',
          params: { tenant: tenantSlug },
        } as unknown as Parameters<typeof navigate>[0]);
      }}
      onDelete={() => {
        void navigate({
          to: '/t/$tenant/security/roles',
          params: { tenant: tenantSlug },
        } as unknown as Parameters<typeof navigate>[0]);
      }}
    />
  );
}

function AccessPolicyDetailPage({ entityId, tenantSlug }: RendererProps) {
  const navigate = useNavigate();
  const policy = useMockStore((s) => s.accessPolicies[entityId] ?? null);
  if (!policy) return <NotFound what="Access policy" />;
  return (
    <AccessPolicyDetail
      policy={policy}
      onEdit={() => {
        void navigate({
          to: '/t/$tenant/security/access-policies',
          params: { tenant: tenantSlug },
        } as unknown as Parameters<typeof navigate>[0]);
      }}
      onDelete={() => {
        void navigate({
          to: '/t/$tenant/security/access-policies',
          params: { tenant: tenantSlug },
        } as unknown as Parameters<typeof navigate>[0]);
      }}
    />
  );
}

function RbacPolicyDetailPage({ entityId, tenantSlug }: RendererProps) {
  const navigate = useNavigate();
  const policy = useRbacPolicy(tenantSlug, entityId);
  if (!policy) return <NotFound what="RBAC policy" />;
  return (
    <RbacPolicyDetail
      policy={policy}
      onEdit={() => {
        void navigate({
          to: '/t/$tenant/security/rbac-policies',
          params: { tenant: tenantSlug },
        } as unknown as Parameters<typeof navigate>[0]);
      }}
      onDelete={() => {
        void navigate({
          to: '/t/$tenant/security/rbac-policies',
          params: { tenant: tenantSlug },
        } as unknown as Parameters<typeof navigate>[0]);
      }}
    />
  );
}

function PluginDetailPage({ entityId, tenantSlug }: RendererProps) {
  const navigate = useNavigate();
  return (
    <InstalledPluginDetail
      pluginId={entityId}
      tenantSlug={tenantSlug}
      onUninstall={() => {
        void navigate({
          to: '/t/$tenant/plugins',
          params: { tenant: tenantSlug },
        } as unknown as Parameters<typeof navigate>[0]);
      }}
      onClose={() => {
        void navigate({
          to: '/t/$tenant/plugins',
          params: { tenant: tenantSlug },
        } as unknown as Parameters<typeof navigate>[0]);
      }}
    />
  );
}

// ── Registry ─────────────────────────────────────────────────────────────────

interface DetailEntry {
  renderer: DetailRenderer;
  /** Path to navigate back to (after `/t/$tenant`). */
  backTo: string;
  /** Label for the back button. */
  backLabel: string;
}

const DETAIL_REGISTRY: Record<string, DetailEntry> = {
  service: {
    renderer: ServiceDetailPage,
    backTo: '/t/$tenant/services',
    backLabel: 'Back to services',
  },
  route: { renderer: RouteDetailPage, backTo: '/t/$tenant/routes', backLabel: 'Back to routes' },
  user: {
    renderer: UserDetailPage,
    backTo: '/t/$tenant/security/users',
    backLabel: 'Back to users',
  },
  agent: { renderer: AgentDetailPage, backTo: '/t/$tenant/ai/agents', backLabel: 'Back to agents' },
  provider: {
    renderer: ProviderDetailPage,
    backTo: '/t/$tenant/ai/providers',
    backLabel: 'Back to providers',
  },
  tool: { renderer: ToolDetailPage, backTo: '/t/$tenant/ai/tools', backLabel: 'Back to tools' },
  'mcp-server': {
    renderer: McpServerDetailPage,
    backTo: '/t/$tenant/ai/mcp-servers',
    backLabel: 'Back to MCP servers',
  },
  trace: { renderer: TraceDetailPage, backTo: '/t/$tenant/ai/traces', backLabel: 'Back to traces' },
  'rate-limit': {
    renderer: RateLimitDetailPage,
    backTo: '/t/$tenant/ai/rate-limits',
    backLabel: 'Back to rate limits',
  },
  middleware: {
    renderer: MiddlewareDetailPage,
    backTo: '/t/$tenant/middlewares',
    backLabel: 'Back to middlewares',
  },
  'api-key': {
    renderer: ApiKeyDetailPage,
    backTo: '/t/$tenant/security/api-keys',
    backLabel: 'Back to API keys',
  },
  session: {
    renderer: SessionDetailPage,
    backTo: '/t/$tenant/security/sessions',
    backLabel: 'Back to sessions',
  },
  audit: {
    renderer: AuditDetailPage,
    backTo: '/t/$tenant/security/audit',
    backLabel: 'Back to audit log',
  },
  role: {
    renderer: RoleDetailPage,
    backTo: '/t/$tenant/security/roles',
    backLabel: 'Back to roles',
  },
  'access-policy': {
    renderer: AccessPolicyDetailPage,
    backTo: '/t/$tenant/security/access-policies',
    backLabel: 'Back to access policies',
  },
  'rbac-policy': {
    renderer: RbacPolicyDetailPage,
    backTo: '/t/$tenant/security/rbac-policies',
    backLabel: 'Back to RBAC policies',
  },
  plugin: {
    renderer: PluginDetailPage,
    backTo: '/t/$tenant/plugins',
    backLabel: 'Back to plugins',
  },
};

// ── Page ─────────────────────────────────────────────────────────────────────

function DetailPage() {
  const { tenant, kind, id } = Route.useParams();

  const tenantRecord = useMockStore((s) => Object.values(s.tenants).find((t) => t.slug === tenant));
  const tenantId = tenantRecord?.id ?? '';
  const tenantSlug = tenantRecord?.slug ?? tenant;

  const entry = DETAIL_REGISTRY[kind];
  const DetailComponent = entry?.renderer;
  const backLabel = entry?.backLabel ?? 'Back';
  const backTo = entry?.backTo ?? '/t/$tenant/dashboard';

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
          {kind.replace(/-/g, ' ')} detail
        </Title>
      </Group>

      {DetailComponent ? (
        <DetailComponent entityId={id} tenantId={tenantId} tenantSlug={tenantSlug} />
      ) : (
        <Alert color="blue" variant="light" icon={<IconAlertCircle size={16} />}>
          <Text size="sm">
            No full-page detail view registered for{' '}
            <Text component="span" fw={600} ff="monospace">
              {kind}
            </Text>
            . Open this entity from its list page instead.
          </Text>
        </Alert>
      )}
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/_detail/$kind/$id')({
  beforeLoad: requirePermissions({ required: [] }),
  component: DetailPage,
});
