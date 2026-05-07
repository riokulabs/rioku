/**
 * <MiddlewareFullPage> — full-page tabbed editor for a middleware.
 *
 * Tabs (per RD5):
 *   - Config       Monaco JSON editor for the free-form config blob.
 *                  Validates JSON on blur. PUT updates via `updateMiddleware`.
 *   - Bound routes List of routes that reference this middleware id.
 *                  Click-through to the route's full page.
 *   - Audit        Read-only list of audit entries scoped to this middleware
 *                  (resource_type=middleware, resource_id=this id).
 *
 * Monaco in jsdom: the editor relies on browser APIs (ResizeObserver, workers,
 * document.createRange) that jsdom does not implement. Tests mock
 * '@monaco-editor/react' with a trivial <textarea>.
 */
import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Stack,
  Tabs,
  Table,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { IconAlertCircle, IconDeviceFloppy, IconStack } from '@tabler/icons-react';
import { useRouteListReal } from '@/features/routes/api.stage2';
import { useServiceListReal } from '@/features/services/api.stage2';
import { notify } from '@/hooks/use-notify';
import { AuditList, useAuditList, encodeResourceHandle } from '@/features/audit';
import type { AuditFilter } from '@/features/audit';
import type { AuditEntry } from '@/api/resources';
import { useMiddlewareDetail, updateMiddleware } from '../api';

// ─── Monaco (lazy) ────────────────────────────────────────────────────────────

interface MonacoEditorProps {
  value: string;
  language: string;
  onChange: (v: string | undefined) => void;
  onBlur?: () => void;
  height?: number;
  readOnly?: boolean;
}

const LazyMonaco = lazy(async () => {
  const mod = await import('@monaco-editor/react');
  const Editor = mod.default;
  return {
    default: ({ value, language, onChange, onBlur, height = 360, readOnly = false }: MonacoEditorProps) => (
      <Editor
        value={value}
        language={language}
        onChange={onChange}
        onMount={(editor) => {
          editor.onDidBlurEditorText(() => {
            onBlur?.();
          });
        }}
        height={height}
        theme="vs-dark"
        options={{
          readOnly,
          minimap: { enabled: false },
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          fontSize: 13,
          tabSize: 2,
          automaticLayout: true,
        }}
      />
    ),
  };
});

const KIND_COLORS: Record<string, string> = {
  'rate-limit': 'cyan',
  auth: 'red',
  transform: 'violet',
  cors: 'orange',
  cache: 'green',
  logging: 'gray',
  custom: 'grape',
};

const EMPTY_AUDIT_FILTER_BASE: Omit<AuditFilter, 'resource_id_handles' | 'resource_types'> = {
  actions: [],
  outcomes: [],
  tiers: [],
  date_from: null,
  date_to: null,
  actor_handles: [],
  search: '',
};

// ─── Props ────────────────────────────────────────────────────────────────────

export interface MiddlewareFullPageProps {
  middlewareId: string;
  tenantId: string;
  tenantSlug: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MiddlewareFullPage({
  middlewareId,
  tenantId,
  tenantSlug,
}: MiddlewareFullPageProps) {
  const middleware = useMiddlewareDetail(tenantId, middlewareId);
  const { routes } = useRouteListReal(tenantId, undefined);
  const { services: serviceList } = useServiceListReal(tenantId, {
    search: '',
    health: [],
    env: [],
    tags: [],
  });
  const services = useMemo(() => {
    const m: Record<string, (typeof serviceList)[number]> = {};
    for (const s of serviceList) m[s.id] = s;
    return m;
  }, [serviceList]);

  const [draft, setDraft] = useState<string>(() =>
    JSON.stringify(middleware?.config ?? {}, null, 2),
  );
  const [parseError, setParseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const auditFilter: AuditFilter = useMemo(
    () => ({
      ...EMPTY_AUDIT_FILTER_BASE,
      resource_types: ['middleware'],
      resource_id_handles: [encodeResourceHandle('middleware', middlewareId)],
    }),
    [middlewareId],
  );
  const auditEntries = useAuditList(tenantId, auditFilter);

  const referencingRoutes = useMemo(() => {
    if (!middleware) return [];
    return routes.filter((r) => r.middleware_ids.includes(middleware.id));
  }, [routes, middleware]);

  const validateJson = useCallback((): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(draft) as unknown;
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setParseError('Config must be a JSON object.');
        return null;
      }
      setParseError(null);
      return parsed as Record<string, unknown>;
    } catch (e) {
      setParseError((e as Error).message);
      return null;
    }
  }, [draft]);

  const handleBlur = useCallback(() => {
    validateJson();
  }, [validateJson]);

  const handleSave = useCallback(async () => {
    if (!middleware) return;
    const parsed = validateJson();
    if (!parsed) {
      notify.error('Invalid JSON', 'Fix syntax errors before saving.');
      return;
    }
    setSaving(true);
    try {
      await updateMiddleware(tenantId, middleware.id, { config: parsed });
      notify.success('Middleware saved', `${middleware.name} config updated.`);
    } catch (e) {
      notify.error('Save failed', (e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [middleware, validateJson, tenantId]);

  if (!middleware) {
    return (
      <Stack gap="md" p="md">
        <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
          Middleware not found.
        </Alert>
      </Stack>
    );
  }

  return (
    <Stack gap="md" p="md" data-testid="middleware-full-page">
      <Group gap="sm" align="center">
        <IconStack size={26} color="var(--mantine-color-violet-6)" />
        <Title order={2}>{middleware.name}</Title>
        <Badge size="md" variant="light" color={KIND_COLORS[middleware.kind] ?? 'gray'}>
          {middleware.kind}
        </Badge>
        <Badge size="md" variant="light" color={middleware.enabled ? 'green' : 'gray'}>
          {middleware.enabled ? 'enabled' : 'disabled'}
        </Badge>
      </Group>

      <Tabs defaultValue="config" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="config" data-testid="middleware-tab-config">
            Config
          </Tabs.Tab>
          <Tabs.Tab value="bound" data-testid="middleware-tab-bound">
            Bound routes
          </Tabs.Tab>
          <Tabs.Tab value="audit" data-testid="middleware-tab-audit">
            Audit
          </Tabs.Tab>
        </Tabs.List>

        {/* Config tab */}
        <Tabs.Panel value="config" pt="md">
          <Stack gap="sm">
            <Text size="sm" c="var(--mantine-color-gray-7)">
              Edit the middleware config as JSON. The blob is validated on blur and on save.
            </Text>
            <Box
              style={{
                border: '1px solid var(--mantine-color-default-border)',
                borderRadius: 'var(--mantine-radius-sm)',
                overflow: 'hidden',
              }}
              data-testid="middleware-config-editor-host"
            >
              <Suspense
                fallback={
                  <Textarea
                    value={draft}
                    readOnly
                    rows={14}
                    data-testid="middleware-config-editor-fallback"
                    aria-label="Middleware config (loading editor)"
                  />
                }
              >
                <LazyMonaco
                  value={draft}
                  language="json"
                  onChange={(v) => {
                    setDraft(v ?? '');
                  }}
                  onBlur={handleBlur}
                />
              </Suspense>
            </Box>
            {parseError && (
              <Alert
                color="red"
                variant="light"
                icon={<IconAlertCircle size={16} />}
                data-testid="middleware-config-error"
              >
                Invalid JSON: {parseError}
              </Alert>
            )}
            <Group>
              <Button
                size="sm"
                leftSection={<IconDeviceFloppy size={14} />}
                loading={saving}
                disabled={parseError !== null}
                onClick={() => void handleSave()}
                data-testid="middleware-config-save"
              >
                Save config
              </Button>
              <Button
                size="sm"
                variant="default"
                onClick={() => {
                  setDraft(JSON.stringify(middleware.config, null, 2));
                  setParseError(null);
                }}
              >
                Reset
              </Button>
            </Group>
          </Stack>
        </Tabs.Panel>

        {/* Bound routes tab */}
        <Tabs.Panel value="bound" pt="md">
          <Stack gap="sm" data-testid="middleware-bound-routes">
            <Text size="sm" c="var(--mantine-color-gray-7)">
              {referencingRoutes.length === 0
                ? 'No routes reference this middleware.'
                : `Referenced by ${String(referencingRoutes.length)} route${referencingRoutes.length === 1 ? '' : 's'}.`}
            </Text>
            {referencingRoutes.length > 0 && (
              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Route</Table.Th>
                    <Table.Th>Service</Table.Th>
                    <Table.Th>Method</Table.Th>
                    <Table.Th>Path</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {referencingRoutes.map((r) => (
                    <Table.Tr key={r.id} data-testid={`bound-route-${r.id}`}>
                      <Table.Td>
                        <Text size="xs">{r.name}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs">{services[r.service_id]?.name ?? '—'}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge size="xs" variant="outline">
                          {r.method}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" ff="monospace">
                          {r.path}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Button
                          size="compact-xs"
                          variant="subtle"
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
                          component={Link as any}
                          to="/t/$tenant/routes"
                          params={{ tenant: tenantSlug }}
                          search={{ search: r.name }}
                          data-testid={`bound-route-link-${r.id}`}
                        >
                          Open route
                        </Button>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </Stack>
        </Tabs.Panel>

        {/* Audit tab */}
        <Tabs.Panel value="audit" pt="md">
          <Stack gap="sm" data-testid="middleware-audit-tab">
            <Text size="sm" c="var(--mantine-color-gray-7)">
              Audit entries scoped to this middleware.
            </Text>
            <AuditList rows={auditEntries} onSelect={(_e: AuditEntry) => undefined} />
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
