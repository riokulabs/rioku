/**
 * <ObservabilityTraces> — trace retention and sample rate config form.
 *
 * Task 8b.9
 */
import { useState, useEffect } from 'react';
import {
  Button,
  Group,
  NumberInput,
  Stack,
  Title,
  Tooltip,
} from '@mantine/core';
import { useForm, schemaResolver } from '@mantine/form';
import { IconLock } from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import { useCurrentObservabilityConfig, updateObservabilityTraces } from '../api';
import { tracesConfigSchema } from '../schemas';
import type { TracesConfigValues } from '../schemas';

// ─── Props ────────────────────────────────────────────────────────────────────

interface ObservabilityTracesProps {
  tenantId: string;
  canWrite: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ObservabilityTraces({ tenantId, canWrite }: ObservabilityTracesProps) {
  const config = useCurrentObservabilityConfig();
  const [saving, setSaving] = useState(false);

  const form = useForm<TracesConfigValues>({
    mode: 'controlled',
    initialValues: {
      retention_days: config?.traces.retention_days ?? 7,
      sample_rate: config?.traces.sample_rate ?? 0.1,
    },
    validate: schemaResolver(tracesConfigSchema, { sync: true }),
  });

  useEffect(() => {
    if (!config) return;
    form.setValues({
      retention_days: config.traces.retention_days,
      sample_rate: config.traces.sample_rate,
    });
    form.resetDirty(form.values);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.traces.retention_days, config?.traces.sample_rate]);

  async function handleSubmit(values: TracesConfigValues) {
    if (!canWrite) return;
    setSaving(true);
    try {
      await updateObservabilityTraces(tenantId, values);
      notify.success('Traces config saved', 'Trace configuration has been updated.');
      form.resetDirty(form.values);
    } catch (e) {
      notify.error('Save failed', (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Stack gap="sm" data-testid="observability-traces">
      <Title order={5}>Traces</Title>
      <form onSubmit={form.onSubmit((values) => { void handleSubmit(values); })}>
        <Stack gap="sm">
          <NumberInput
            label="Retention (days)"
            description="How long to retain trace data (0 = disabled)"
            min={0}
            max={365}
            required
            data-testid="traces-retention-days-input"
            {...form.getInputProps('retention_days')}
          />

          <NumberInput
            label="Sample rate"
            description="Fraction of traces to record (0.0 = none, 1.0 = every trace)"
            min={0}
            max={1}
            step={0.01}
            decimalScale={2}
            required
            data-testid="traces-sample-rate-input"
            {...form.getInputProps('sample_rate')}
          />

          <Group justify="flex-end" mt="sm">
            <Tooltip label="Requires traces:write permission" disabled={canWrite}>
              <span>
                <Button
                  type="submit"
                  loading={saving}
                  disabled={!canWrite || saving}
                  leftSection={!canWrite ? <IconLock size={14} /> : undefined}
                  data-testid="traces-save-button"
                >
                  Save traces config
                </Button>
              </span>
            </Tooltip>
          </Group>
        </Stack>
      </form>
    </Stack>
  );
}
