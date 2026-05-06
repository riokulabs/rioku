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
 *   - Submit saves both url_mode and parent_domain atomically
 *
 * Permission guard: tenant:write for mutations; tenant:switch for read.
 *
 * Plan 12 Task 1
 */
import { useState, useCallback } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import {
  Alert,
  Anchor,
  Button,
  Divider,
  Group,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconAlertTriangle, IconArrowLeft, IconInfoCircle } from '@tabler/icons-react';
import { useMockStore } from '@/api/mock-store';
import { requirePermissions } from '@/hooks/use-before-load';
import { usePermission } from '@/hooks/use-permission';
import { notify } from '@/hooks/use-notify';
import { updateTenantUrlModeWithDomain } from '@/features/settings/api';

// ─── URL mode options ─────────────────────────────────────────────────────────

const URL_MODE_DATA: { label: string; value: string }[] = [
  { label: 'Path (/t/<slug>/...)', value: 'path' },
  { label: 'Subdomain (<slug>.<domain>)', value: 'subdomain' },
];

// ─── Form values ──────────────────────────────────────────────────────────────

interface UrlModeFormValues {
  url_mode: 'path' | 'subdomain';
  parent_domain: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

function UrlModeSettingsPage() {
  const { tenant: tenantSlug } = Route.useParams();
  const tenantRecord = useMockStore((s) =>
    Object.values(s.tenants).find((t) => t.slug === tenantSlug),
  );
  const tenantId = tenantRecord?.id ?? '';
  const canWrite = usePermission('tenant:write');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<UrlModeFormValues>({
    initialValues: {
      url_mode: tenantRecord?.url_mode ?? 'path',
      parent_domain: tenantRecord?.parent_domain ?? 'localhost',
    },
  });

  // Warn when the user has changed the mode from the persisted value.
  const modeChanging =
    tenantRecord !== undefined && form.values.url_mode !== tenantRecord.url_mode;

  const handleSubmit = useCallback(
    async (values: UrlModeFormValues) => {
      if (!tenantRecord) return;
      setLoading(true);
      setError(null);
      try {
        await updateTenantUrlModeWithDomain(
          tenantId,
          values.url_mode,
          values.url_mode === 'subdomain' ? values.parent_domain : undefined,
        );
        notify.success(
          'URL mode updated',
          values.url_mode === 'subdomain'
            ? `Subdomain mode enabled. Parent domain: ${values.parent_domain}.`
            : 'Path mode enabled.',
        );
        form.resetDirty(values);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to update URL mode';
        setError(msg);
      } finally {
        setLoading(false);
      }
    },
    [tenantRecord, tenantId, form],
  );

  if (!tenantRecord) {
    return (
      <Text size="sm" c="var(--mantine-color-gray-7)" data-testid="url-mode-loading">
        Loading tenant…
      </Text>
    );
  }

  return (
    <Stack gap="md" p="md" data-testid="url-mode-page">
      {/* Back link */}
      <Group gap="xs">
        <Anchor
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
          component={Link as any}
          to="/t/$tenant/settings"
          params={{ tenant: tenantRecord.slug }}
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
          Current mode: <strong>{tenantRecord.url_mode === 'path' ? 'Path' : 'Subdomain'}</strong>
          {tenantRecord.url_mode === 'subdomain' && tenantRecord.parent_domain && (
            <> — parent domain: <strong>{tenantRecord.parent_domain}</strong></>
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
                    loading={loading}
                    disabled={!canWrite}
                    data-testid="url-mode-save"
                  >
                    Save changes
                  </Button>
                </span>
              </Tooltip>
              <Button
                variant="default"
                disabled={loading}
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
