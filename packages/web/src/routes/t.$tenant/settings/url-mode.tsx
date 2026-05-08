/**
 * URL mode settings — /t/$tenant/settings/url-mode.
 *
 * Dedicated page for tenant URL mode configuration (Plan 12 §8.4).
 * Ownership of the url_mode setting lives here, not in the general tenant
 * section (which shows a read-only indicator that links here).
 *
 * Form:
 *   - URL mode toggle (path / subdomain) via SegmentedControl
 *   - Parent domain text input — shown only when subdomain mode is selected
 *   - Warning banner when mode differs from current: "Re-auth required after
 *     switch; existing sessions will be invalidated"
 *   - Submit saves both url_mode and parent_domain atomically via the
 *     `/api/v1/t/{tenant}/settings/tenant` PATCH endpoint.
 *
 * Permission guard: tenant:write for mutations; tenant:switch for read.
 *
 * Plan 12 Task 1 (originally mock-store-backed); rewired to the real
 * settings/tenant endpoint as part of plan 16a part 2.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import {
  Alert,
  Anchor,
  Button,
  Divider,
  Group,
  Loader,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconAlertTriangle, IconArrowLeft, IconInfoCircle } from '@tabler/icons-react';
import { requirePermissions } from '@/hooks/use-before-load';
import { usePermission } from '@/hooks/use-permission';
import { notify } from '@/hooks/use-notify';
import {
  useGetSettingsTenant,
  usePatchSettingsTenant,
} from '@/api/generated/settings/settings';

// ─── URL mode options ─────────────────────────────────────────────────────────

const URL_MODE_DATA: { label: string; value: string }[] = [
  { label: 'Path (/t/<slug>/...)', value: 'path' },
  { label: 'Subdomain (<slug>.<domain>)', value: 'subdomain' },
];

// ─── Form values ──────────────────────────────────────────────────────────────

type UrlMode = 'path' | 'subdomain';

interface UrlModeFormValues {
  url_mode: UrlMode;
  parent_domain: string;
}

interface SettingsTenantShape {
  slug?: string;
  urlMode?: string;
  parentDomain?: string;
}

// The Orval mutator wraps responses as { data, status, headers }; pull
// the `data` field if present, otherwise treat the payload as already
// unwrapped.
function unwrapTenant(payload: unknown): SettingsTenantShape | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  if ('data' in payload) {
    return (payload as { data: SettingsTenantShape }).data;
  }
  return payload as SettingsTenantShape;
}

// ─── Component ────────────────────────────────────────────────────────────────

function UrlModeSettingsPage() {
  const { tenant: tenantSlug } = Route.useParams();
  const canWrite = usePermission('tenant:write');

  const query = useGetSettingsTenant(tenantSlug);
  const patch = usePatchSettingsTenant();

  const tenantRecord = unwrapTenant(query.data);

  const [error, setError] = useState<string | null>(null);
  const hydratedRef = useRef(false);

  const form = useForm<UrlModeFormValues>({
    initialValues: {
      url_mode: 'path',
      parent_domain: 'localhost',
    },
  });

  // Hydrate the form once when the GET completes. Subsequent edits are
  // owned by the user; do not trample them. We track `hydrated` via a
  // ref rather than state to avoid the lint against setState-in-effect:
  // the form library mutation is the external system being synchronized
  // here, and we never need to re-render purely on the hydration flag.
  useEffect(() => {
    if (!tenantRecord || hydratedRef.current) return;
    form.setValues({
      url_mode: (tenantRecord.urlMode as UrlMode | undefined) ?? 'path',
      parent_domain: tenantRecord.parentDomain ?? 'localhost',
    });
    form.resetDirty();
    hydratedRef.current = true;
  }, [tenantRecord, form]);

  // Warn when the user has changed the mode from the persisted value.
  // We only flag the change when the data has loaded AND the user has
  // dirtied the form — that combination is enough; we don't need the
  // hydration ref at render time.
  const persistedMode = (tenantRecord?.urlMode as UrlMode | undefined) ?? 'path';
  const modeChanging = !!tenantRecord && form.isDirty('url_mode') && form.values.url_mode !== persistedMode;

  const handleSubmit = useCallback(
    async (values: UrlModeFormValues) => {
      setError(null);
      try {
        await patch.mutateAsync({
          tenant: tenantSlug,
          data: {
            urlMode: values.url_mode,
            // Only push parentDomain on subdomain mode; merge-patch
            // semantics: omitted keys preserve existing server value.
            ...(values.url_mode === 'subdomain'
              ? { parentDomain: values.parent_domain }
              : {}),
          },
        });
        notify.success(
          'URL mode updated',
          values.url_mode === 'subdomain'
            ? `Subdomain mode enabled. Parent domain: ${values.parent_domain}.`
            : 'Path mode enabled.',
        );
        form.resetDirty(values);
        await query.refetch();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to update URL mode';
        setError(msg);
      }
    },
    [tenantSlug, patch, form, query],
  );

  if (query.isLoading) {
    return (
      <Stack align="center" py="xl" data-testid="url-mode-loading">
        <Loader />
      </Stack>
    );
  }
  if (query.isError) {
    return (
      <Alert color="red" data-testid="url-mode-load-error">
        Failed to load tenant: {(query.error as Error).message}
      </Alert>
    );
  }
  if (!tenantRecord) {
    return (
      <Text size="sm" c="var(--mantine-color-gray-7)" data-testid="url-mode-empty">
        Tenant not found.
      </Text>
    );
  }

  const slug = tenantRecord.slug ?? tenantSlug;

  return (
    <Stack gap="md" p="md" data-testid="url-mode-page">
      {/* Back link */}
      <Group gap="xs">
        <Anchor
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
          component={Link as any}
          to="/t/$tenant/settings"
          params={{ tenant: slug }}
          size="sm"
          data-testid="url-mode-back"
        >
          <Group gap={4} align="center">
            <IconArrowLeft size={14} />
            <span>Back to settings</span>
          </Group>
        </Anchor>
      </Group>

      <Stack gap={4}>
        <Title order={2}>URL mode</Title>
        <Text size="sm" c="var(--mantine-color-gray-7)">
          Choose how this tenant is addressed in URLs. Changing this setting will invalidate all
          existing sessions.
        </Text>
      </Stack>

      <Divider />

      {/* Re-auth warning — shown when mode is about to change */}
      {modeChanging && (
        <Alert
          icon={<IconAlertTriangle size={16} />}
          color="orange"
          variant="light"
          data-testid="url-mode-reauth-warning"
        >
          <Text size="sm" fw={500}>
            Re-auth required after switch; existing sessions will be invalidated.
          </Text>
          <Text size="xs" mt={4}>
            All users will be logged out and must sign in again after you save this change.
          </Text>
        </Alert>
      )}

      {/* Current mode info */}
      <Alert
        icon={<IconInfoCircle size={16} />}
        color="blue"
        variant="light"
        data-testid="url-mode-current-info"
      >
        <Text size="sm">
          Current mode: <strong>{persistedMode === 'path' ? 'Path' : 'Subdomain'}</strong>
          {persistedMode === 'subdomain' && tenantRecord.parentDomain && (
            <> — parent domain: <strong>{tenantRecord.parentDomain}</strong></>
          )}
        </Text>
      </Alert>

      {/* Error */}
      {error && (
        <Alert color="red" variant="light" data-testid="url-mode-error">
          {error}
        </Alert>
      )}

      {/* Form */}
      <form
        onSubmit={form.onSubmit((v) => {
          void handleSubmit(v);
        })}
        data-testid="url-mode-form"
      >
        <Stack gap="md">
          {/* Mode toggle */}
          <Stack gap="xs">
            <Text size="sm" fw={500}>
              Addressing mode
            </Text>
            <Tooltip
              label="You don't have permission to update tenant settings"
              disabled={canWrite}
              withArrow
            >
              <span style={{ alignSelf: 'flex-start' }}>
                <SegmentedControl
                  data={URL_MODE_DATA}
                  disabled={!canWrite}
                  data-testid="url-mode-control"
                  {...form.getInputProps('url_mode')}
                />
              </span>
            </Tooltip>
          </Stack>

          {/* Parent domain — only shown in subdomain mode */}
          {form.values.url_mode === 'subdomain' && (
            <TextInput
              label="Parent domain"
              description="The base domain for subdomain routing. Session cookies will be scoped to this domain. E.g. 'localhost' for development, 'mycompany.com' for production."
              placeholder="localhost"
              disabled={!canWrite}
              data-testid="url-mode-parent-domain"
              {...form.getInputProps('parent_domain')}
            />
          )}

          {/* Submit */}
          {form.isDirty() && (
            <Group>
              <Tooltip
                label="You don't have permission to update tenant settings"
                disabled={canWrite}
                withArrow
              >
                <span>
                  <Button
                    type="submit"
                    loading={patch.isPending}
                    disabled={!canWrite}
                    data-testid="url-mode-save"
                  >
                    Save changes
                  </Button>
                </span>
              </Tooltip>
              <Button
                variant="default"
                disabled={patch.isPending}
                onClick={() => {
                  form.reset();
                  setError(null);
                }}
                data-testid="url-mode-cancel"
              >
                Cancel
              </Button>
            </Group>
          )}
        </Stack>
      </form>
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/settings/url-mode')({
  beforeLoad: requirePermissions({ required: ['tenant:switch'] }),
  component: UrlModeSettingsPage,
});
