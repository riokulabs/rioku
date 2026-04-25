/**
 * <NetworkSection> — settings network section.
 *
 * Renders 4 fieldsets:
 *   1. Listen addresses (read-only display in stage 1)
 *   2. Caddy config overrides (Monaco JSON editor, lazy-loaded)
 *   3. HTTP/3 (Switch)
 *   4. Upstream timeouts (NumberInputs)
 *
 * Requires `network:write` for save. In stage 1, save writes to mock store.
 *
 * Task 8b.6
 */
import { lazy, Suspense, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Divider,
  Group,
  NumberInput,
  SimpleGrid,
  Skeleton,
  Stack,
  Switch,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { useForm, schemaResolver } from '@mantine/form';
import { IconAlertCircle, IconLock } from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import { usePermission } from '@/hooks/use-permission';
import { useCurrentTenant, useCurrentNetworkConfig, updateNetworkConfig } from '../api';
import { networkConfigSchema } from '../schemas';
import type { NetworkConfigValues } from '../schemas';

// ─── Monaco (lazy) ────────────────────────────────────────────────────────────

interface MonacoEditorProps {
  value: string;
  language: string;
  onChange: (v: string | undefined) => void;
  height?: number;
}

/**
 * Lazy Monaco wrapper — isolates the heavy dep behind a dynamic import so it
 * ships in its own async chunk and is only fetched when the network section
 * actually renders.
 */
const LazyMonaco = lazy(async () => {
  const mod = await import('@monaco-editor/react');
  const Editor = mod.default;
  return {
    default: ({ value, language, onChange, height = 220 }: MonacoEditorProps) => (
      <Editor
        value={value}
        language={language}
        onChange={onChange}
        height={height}
        theme="vs-dark"
        options={{
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

// ─── Default values ───────────────────────────────────────────────────────────

const DEFAULT_VALUES: NetworkConfigValues = {
  caddy_config_overrides: '{}\n',
  http3_enabled: true,
  upstream_timeouts: {
    connect: 10,
    read: 60,
    write: 60,
    idle: 120,
  },
};

// ─── Component ────────────────────────────────────────────────────────────────

export function NetworkSection() {
  const canWrite = usePermission('network:write');
  const tenant = useCurrentTenant();
  const config = useCurrentNetworkConfig();

  const [saving, setSaving] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);

  const initialValues: NetworkConfigValues = config
    ? {
        caddy_config_overrides: config.caddy_config_overrides,
        http3_enabled: config.http3_enabled,
        upstream_timeouts: { ...config.upstream_timeouts },
      }
    : DEFAULT_VALUES;

  const form = useForm<NetworkConfigValues>({
    mode: 'controlled',
    initialValues,
    validate: schemaResolver(networkConfigSchema, { sync: true }),
  });

  const dirty = form.isDirty();

  function handleCaddyChange(value: string | undefined) {
    form.setFieldValue('caddy_config_overrides', value ?? '');
  }

  function handleCaddyBlur() {
    const raw = form.values.caddy_config_overrides;
    try {
      JSON.parse(raw);
      setJsonError(null);
    } catch (e) {
      setJsonError((e as Error).message);
    }
  }

  async function handleSave() {
    if (!canWrite || !tenant) return;

    const validation = form.validate();
    if (validation.hasErrors) return;

    setSaving(true);
    try {
      await updateNetworkConfig(tenant.id, {
        caddy_config_overrides: form.values.caddy_config_overrides,
        http3_enabled: form.values.http3_enabled,
        upstream_timeouts: form.values.upstream_timeouts,
      });
      form.resetDirty(form.values);
      notify.success(
        'Network config updated',
        'Changes will take effect when the daemon applies the configuration.',
      );
    } catch (e) {
      notify.error('Save failed', (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const saveDisabled = !canWrite || !dirty || saving;

  return (
    <Stack gap="lg">
      {/* 1. Listen addresses — read-only display in stage 1 */}
      <Stack gap="sm" data-testid="fieldset-listen-addresses">
        <Title order={5}>Listen addresses</Title>
        <Group gap="xs" wrap="wrap">
          {(config?.listen_addresses ?? [':443', ':80']).map((addr) => (
            <Badge key={addr} variant="outline" data-testid={`listen-address-${addr}`}>
              {addr}
            </Badge>
          ))}
        </Group>
      </Stack>

      <Divider />

      {/* 2. Caddy config overrides */}
      <Stack gap="sm" data-testid="fieldset-caddy-config">
        <Title order={5}>Caddy config overrides</Title>
        <Text size="sm" c="var(--mantine-color-gray-7)">
          Free-form Caddy JSON overrides applied to the managed Caddy process. Validated at stage 2
          before apply.
        </Text>
        <Suspense fallback={<Skeleton height={220} data-testid="monaco-skeleton" />}>
          <div onBlur={handleCaddyBlur} data-testid="caddy-editor-wrapper">
            <LazyMonaco
              value={form.values.caddy_config_overrides}
              language="json"
              onChange={handleCaddyChange}
              height={220}
            />
          </div>
        </Suspense>
        {jsonError != null && (
          <Alert
            icon={<IconAlertCircle size={16} />}
            color="orange"
            variant="light"
            title="Invalid JSON"
            data-testid="json-error-alert"
          >
            {jsonError}
          </Alert>
        )}
      </Stack>

      <Divider />

      {/* 3. HTTP/3 */}
      <Stack gap="sm" data-testid="fieldset-http3">
        <Title order={5}>HTTP/3 (QUIC)</Title>
        <Switch
          label="Enable HTTP/3 (QUIC)"
          description="Enables QUIC transport on UDP. Requires a TLS certificate."
          disabled={!canWrite}
          data-testid="http3-switch"
          checked={form.values.http3_enabled}
          onChange={(e) => {
            form.setFieldValue('http3_enabled', e.currentTarget.checked);
          }}
        />
      </Stack>

      <Divider />

      {/* 4. Upstream timeouts */}
      <Stack gap="sm" data-testid="fieldset-upstream-timeouts">
        <Title order={5}>Upstream timeouts</Title>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          <NumberInput
            label="Connect timeout (s)"
            description="1–300 seconds"
            min={1}
            max={300}
            disabled={!canWrite}
            data-testid="timeout-connect"
            {...form.getInputProps('upstream_timeouts.connect')}
          />
          <NumberInput
            label="Read timeout (s)"
            description="1–3600 seconds"
            min={1}
            max={3600}
            disabled={!canWrite}
            data-testid="timeout-read"
            {...form.getInputProps('upstream_timeouts.read')}
          />
          <NumberInput
            label="Write timeout (s)"
            description="1–3600 seconds"
            min={1}
            max={3600}
            disabled={!canWrite}
            data-testid="timeout-write"
            {...form.getInputProps('upstream_timeouts.write')}
          />
          <NumberInput
            label="Idle timeout (s)"
            description="1–3600 seconds"
            min={1}
            max={3600}
            disabled={!canWrite}
            data-testid="timeout-idle"
            {...form.getInputProps('upstream_timeouts.idle')}
          />
        </SimpleGrid>
      </Stack>

      {/* Save */}
      <Group justify="flex-end">
        <Tooltip label="Requires network:write permission" disabled={canWrite}>
          <span>
            <Button
              leftSection={!canWrite ? <IconLock size={14} /> : undefined}
              onClick={() => {
                void handleSave();
              }}
              loading={saving}
              disabled={saveDisabled}
              data-testid="save-button"
            >
              Save
            </Button>
          </span>
        </Tooltip>
      </Group>
    </Stack>
  );
}
