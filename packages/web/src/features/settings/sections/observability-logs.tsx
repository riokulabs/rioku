/**
 * <ObservabilityLogs> — per-component log levels, format, and rotation config.
 *
 * Task 8b.9
 */
import { useState, useEffect } from 'react';
import {
  Button,
  Checkbox,
  Group,
  NumberInput,
  Select,
  Stack,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { useForm, schemaResolver } from '@mantine/form';
import { IconLock } from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import { useCurrentObservabilityConfig, updateObservabilityLogs } from '../api';
import { logsConfigSchema } from '../schemas';
import type { LogsConfigValues } from '../schemas';

// ─── Props ────────────────────────────────────────────────────────────────────

interface ObservabilityLogsProps {
  tenantId: string;
  canWrite: boolean;
}

// ─── Level options ────────────────────────────────────────────────────────────

const LEVEL_OPTIONS = [
  { value: 'debug', label: 'Debug' },
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warn' },
  { value: 'error', label: 'Error' },
];

const FORMAT_OPTIONS = [
  { value: 'json', label: 'JSON (structured)' },
  { value: 'text', label: 'Text (plain)' },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function ObservabilityLogs({ tenantId, canWrite }: ObservabilityLogsProps) {
  const config = useCurrentObservabilityConfig();
  const [saving, setSaving] = useState(false);

  const form = useForm<LogsConfigValues>({
    mode: 'controlled',
    initialValues: {
      levels: {
        daemon: config?.logs.levels.daemon ?? 'info',
        caddy: config?.logs.levels.caddy ?? 'info',
        plugin: config?.logs.levels.plugin ?? 'warn',
      },
      format: config?.logs.format ?? 'json',
      rotation: {
        max_size_mb: config?.logs.rotation.max_size_mb ?? 100,
        max_backups: config?.logs.rotation.max_backups ?? 5,
        max_age_days: config?.logs.rotation.max_age_days ?? 30,
        compress: config?.logs.rotation.compress ?? true,
      },
    },
    validate: schemaResolver(logsConfigSchema, { sync: true }),
  });

  useEffect(() => {
    if (!config) return;
    form.setValues({
      levels: {
        daemon: config.logs.levels.daemon,
        caddy: config.logs.levels.caddy,
        plugin: config.logs.levels.plugin,
      },
      format: config.logs.format,
      rotation: {
        max_size_mb: config.logs.rotation.max_size_mb,
        max_backups: config.logs.rotation.max_backups,
        max_age_days: config.logs.rotation.max_age_days,
        compress: config.logs.rotation.compress,
      },
    });
    form.resetDirty(form.values);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    config?.logs.levels.daemon,
    config?.logs.levels.caddy,
    config?.logs.levels.plugin,
    config?.logs.format,
    config?.logs.rotation.max_size_mb,
    config?.logs.rotation.max_backups,
    config?.logs.rotation.max_age_days,
    config?.logs.rotation.compress,
  ]);

  async function handleSubmit(values: LogsConfigValues) {
    if (!canWrite) return;
    setSaving(true);
    try {
      await updateObservabilityLogs(tenantId, values);
      notify.success('Logs config saved', 'Log configuration has been updated.');
      form.resetDirty(form.values);
    } catch (e) {
      notify.error('Save failed', (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Stack gap="sm" data-testid="observability-logs">
      <Title order={5}>Logs</Title>
      <form
        onSubmit={form.onSubmit((values) => {
          void handleSubmit(values);
        })}
      >
        <Stack gap="sm">
          <Text size="sm" fw={500}>
            Log levels per component
          </Text>

          <Group grow>
            <Select
              label="Daemon"
              description="rioku daemon process"
              data={LEVEL_OPTIONS}
              required
              data-testid="logs-daemon-level-select"
              {...form.getInputProps('levels.daemon')}
            />
            <Select
              label="Caddy"
              description="Caddy subprocess"
              data={LEVEL_OPTIONS}
              required
              data-testid="logs-caddy-level-select"
              {...form.getInputProps('levels.caddy')}
            />
            <Select
              label="Plugin"
              description="Plugin processes"
              data={LEVEL_OPTIONS}
              required
              data-testid="logs-plugin-level-select"
              {...form.getInputProps('levels.plugin')}
            />
          </Group>

          <Select
            label="Log format"
            description="Output format for log entries"
            data={FORMAT_OPTIONS}
            required
            data-testid="logs-format-select"
            {...form.getInputProps('format')}
          />

          <Text size="sm" fw={500}>
            Log rotation
          </Text>

          <Group grow>
            <NumberInput
              label="Max size (MB)"
              description="Maximum log file size before rotation (1–1024 MB)"
              min={1}
              max={1024}
              required
              data-testid="logs-max-size-input"
              {...form.getInputProps('rotation.max_size_mb')}
            />
            <NumberInput
              label="Max backups"
              description="Number of old log files to retain (0 = unlimited)"
              min={0}
              max={100}
              required
              data-testid="logs-max-backups-input"
              {...form.getInputProps('rotation.max_backups')}
            />
            <NumberInput
              label="Max age (days)"
              description="Delete logs older than this (0 = disabled)"
              min={0}
              max={365}
              required
              data-testid="logs-max-age-input"
              {...form.getInputProps('rotation.max_age_days')}
            />
          </Group>

          <Checkbox
            label="Compress rotated files"
            description="Gzip-compress rotated log files to save disk space"
            data-testid="logs-compress-checkbox"
            {...form.getInputProps('rotation.compress', { type: 'checkbox' })}
          />

          <Group justify="flex-end" mt="sm">
            <Tooltip label="Requires logs:write permission" disabled={canWrite}>
              <span>
                <Button
                  type="submit"
                  loading={saving}
                  disabled={!canWrite || saving}
                  leftSection={!canWrite ? <IconLock size={14} /> : undefined}
                  data-testid="logs-save-button"
                >
                  Save logs config
                </Button>
              </span>
            </Tooltip>
          </Group>
        </Stack>
      </form>
    </Stack>
  );
}
