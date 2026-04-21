/**
 * <ObservabilityMetrics> — Prometheus scrape endpoint + retention config form.
 *
 * Task 8b.9
 */
import { useState, useEffect } from 'react';
import {
  Button,
  Group,
  NumberInput,
  Select,
  Stack,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { useForm, schemaResolver } from '@mantine/form';
import { IconLock } from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import { useCurrentObservabilityConfig, updateObservabilityMetrics } from '../api';
import { metricsConfigSchema } from '../schemas';
import type { MetricsConfigValues } from '../schemas';

// ─── Props ────────────────────────────────────────────────────────────────────

interface ObservabilityMetricsProps {
  tenantId: string;
  canWrite: boolean;
}

// ─── Auth options ─────────────────────────────────────────────────────────────

const AUTH_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'bearer', label: 'Bearer token' },
  { value: 'mtls', label: 'mTLS' },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function ObservabilityMetrics({ tenantId, canWrite }: ObservabilityMetricsProps) {
  const config = useCurrentObservabilityConfig();
  const [saving, setSaving] = useState(false);

  const form = useForm<MetricsConfigValues>({
    mode: 'controlled',
    initialValues: {
      scrape_endpoint: config?.metrics.scrape_endpoint ?? '/metrics',
      scrape_auth: config?.metrics.scrape_auth ?? 'bearer',
      retention_days: config?.metrics.retention_days ?? 30,
    },
    validate: schemaResolver(metricsConfigSchema, { sync: true }),
  });

  useEffect(() => {
    if (!config) return;
    form.setValues({
      scrape_endpoint: config.metrics.scrape_endpoint,
      scrape_auth: config.metrics.scrape_auth,
      retention_days: config.metrics.retention_days,
    });
    form.resetDirty(form.values);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.metrics.scrape_endpoint, config?.metrics.scrape_auth, config?.metrics.retention_days]);

  async function handleSubmit(values: MetricsConfigValues) {
    if (!canWrite) return;
    setSaving(true);
    try {
      await updateObservabilityMetrics(tenantId, values);
      notify.success('Metrics config saved', 'Metrics configuration has been updated.');
      form.resetDirty(form.values);
    } catch (e) {
      notify.error('Save failed', (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Stack gap="sm" data-testid="observability-metrics">
      <Title order={5}>Metrics</Title>
      <form onSubmit={form.onSubmit((values) => { void handleSubmit(values); })}>
        <Stack gap="sm">
          <TextInput
            label="Scrape endpoint"
            description="Prometheus scrape endpoint path (must start with /)"
            placeholder="/metrics"
            required
            data-testid="metrics-scrape-endpoint-input"
            {...form.getInputProps('scrape_endpoint')}
          />

          <Select
            label="Scrape auth"
            description="Authentication method for the Prometheus scrape endpoint"
            data={AUTH_OPTIONS}
            required
            data-testid="metrics-scrape-auth-select"
            {...form.getInputProps('scrape_auth')}
          />

          <NumberInput
            label="Retention (days)"
            description="How long to retain scraped metrics (0 = use Prometheus default)"
            min={0}
            max={3650}
            required
            data-testid="metrics-retention-days-input"
            {...form.getInputProps('retention_days')}
          />

          <Group justify="flex-end" mt="sm">
            <Tooltip label="Requires metrics:write permission" disabled={canWrite}>
              <span>
                <Button
                  type="submit"
                  loading={saving}
                  disabled={!canWrite || saving}
                  leftSection={!canWrite ? <IconLock size={14} /> : undefined}
                  data-testid="metrics-save-button"
                >
                  Save metrics config
                </Button>
              </span>
            </Tooltip>
          </Group>
        </Stack>
      </form>
    </Stack>
  );
}
