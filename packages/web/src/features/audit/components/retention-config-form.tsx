/**
 * <RetentionConfigForm> — create / edit the per-tenant audit retention
 * config.
 *
 * Shape:
 *   Fieldset "Retention (days per tier)"
 *     NumberInput  read
 *     NumberInput  read-sensitive
 *     NumberInput  write
 *     NumberInput  destructive
 *   SegmentedControl  auto_export        (never / daily / weekly / monthly)
 *   SegmentedControl  auto_export_format (csv / jsonl — disabled when never)
 *   Save button (requires `audit:retention:write`)
 *
 * Permission model:
 *   - `audit:retention:read` gates access to the route (beforeLoad).
 *   - `audit:retention:write` gates the Save button. Readers see the
 *     form populated + disabled.
 *
 * Validation:
 *   - `retentionConfigSchema` (Zod) enforces 0..3650 days per tier and
 *     enum bounds on both segmented controls. `schemaResolver({sync: true})`
 *     is safe here — no async refinements in the schema.
 */
import { useState } from 'react';
import {
  Alert,
  Button,
  Fieldset,
  Group,
  NumberInput,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { useForm, schemaResolver } from '@mantine/form';
import { IconAlertCircle } from '@tabler/icons-react';
import { z } from 'zod';
import { notify } from '@/hooks/use-notify';
import { usePermission } from '@/hooks/use-permission';
import type { AuditRetentionConfig } from '@/api/resources/types';
import { updateRetentionConfig, useRetentionConfig } from '../api';

interface RetentionConfigFormProps {
  tenantId: string;
}

type AutoExport = AuditRetentionConfig['auto_export'];
type AutoExportFormat = AuditRetentionConfig['auto_export_format'];

/**
 * Flat form shape. The canonical schema in `schemas.ts` uses a nested
 * `retention_days` object whose `'read-sensitive'` key contains a hyphen,
 * and Mantine's `form.getInputProps('retention_days.read-sensitive')` does
 * not round-trip cleanly through its dot-notation path splitter. Flatten
 * here, then re-nest at submit.
 */
interface FlatFormValues {
  retention_read: number;
  retention_read_sensitive: number;
  retention_write: number;
  retention_destructive: number;
  auto_export: AutoExport;
  auto_export_format: AutoExportFormat;
}

const retentionDayField = z.number().int().min(0).max(3650);

const flatFormSchema = z.object({
  retention_read: retentionDayField,
  retention_read_sensitive: retentionDayField,
  retention_write: retentionDayField,
  retention_destructive: retentionDayField,
  auto_export: z.enum(['daily', 'weekly', 'monthly', 'never']),
  auto_export_format: z.enum(['csv', 'jsonl']),
});

/** Sane defaults matching the §4.3 Audit defaults used in the seed. */
const DEFAULT_VALUES: FlatFormValues = {
  retention_read: 30,
  retention_read_sensitive: 90,
  retention_write: 365,
  retention_destructive: 730,
  auto_export: 'never',
  auto_export_format: 'jsonl',
};

function initialFromConfig(cfg?: AuditRetentionConfig): FlatFormValues {
  if (!cfg) return DEFAULT_VALUES;
  return {
    retention_read: cfg.retention_days.read,
    retention_read_sensitive: cfg.retention_days['read-sensitive'],
    retention_write: cfg.retention_days.write,
    retention_destructive: cfg.retention_days.destructive,
    auto_export: cfg.auto_export,
    auto_export_format: cfg.auto_export_format,
  };
}

export function RetentionConfigForm({ tenantId }: RetentionConfigFormProps) {
  const current = useRetentionConfig(tenantId);
  const canWrite = usePermission('audit:retention:write');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<FlatFormValues>({
    initialValues: initialFromConfig(current),
    validate: schemaResolver(flatFormSchema, { sync: true }),
  });

  async function handleSubmit(values: FlatFormValues) {
    setLoading(true);
    setError(null);
    try {
      const next = await updateRetentionConfig(tenantId, {
        retention_days: {
          read: values.retention_read,
          'read-sensitive': values.retention_read_sensitive,
          write: values.retention_write,
          destructive: values.retention_destructive,
        },
        auto_export: values.auto_export,
        auto_export_format: values.auto_export_format,
      });
      notify.success(
        'Retention saved',
        `Audit retention updated · ${next.auto_export === 'never' ? 'no auto-export' : `auto-exporting ${next.auto_export} as ${next.auto_export_format.toUpperCase()}`}.`,
      );
      form.resetDirty(values);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save config';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  const autoExportIsNever = form.values.auto_export === 'never';

  return (
    <form
      onSubmit={form.onSubmit((v) => {
        void handleSubmit(v);
      })}
      data-testid="audit-retention-form"
    >
      <Stack gap="md">
        {error && (
          <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">
            {error}
          </Alert>
        )}

        <Fieldset legend="Retention (days per tier)">
          <Text size="sm" mb="sm">
            Entries older than the configured number of days are eligible for deletion. Set to 0 to
            purge immediately.
          </Text>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
            <NumberInput
              label="Read"
              description="Non-sensitive read events."
              min={0}
              max={3650}
              required
              data-testid="retention-read"
              disabled={!canWrite}
              {...form.getInputProps('retention_read')}
            />
            <NumberInput
              label="Read (sensitive)"
              description="Reads that exposed PII — payload bodies, IP, user-agent."
              min={0}
              max={3650}
              required
              data-testid="retention-read-sensitive"
              disabled={!canWrite}
              {...form.getInputProps('retention_read_sensitive')}
            />
            <NumberInput
              label="Write"
              description="Create / update operations."
              min={0}
              max={3650}
              required
              data-testid="retention-write"
              disabled={!canWrite}
              {...form.getInputProps('retention_write')}
            />
            <NumberInput
              label="Destructive"
              description="Deletes + purges. Typically the longest retention."
              min={0}
              max={3650}
              required
              data-testid="retention-destructive"
              disabled={!canWrite}
              {...form.getInputProps('retention_destructive')}
            />
          </SimpleGrid>
        </Fieldset>

        <Stack gap="xs">
          <Text size="sm" fw={500}>
            Auto-export
          </Text>
          <Text size="xs">
            Schedule audit entries to be written to long-term storage on the selected cadence before
            they are purged by the retention policy above.
          </Text>
          <SegmentedControl<AutoExport>
            data={[
              { value: 'never', label: 'Never' },
              { value: 'daily', label: 'Daily' },
              { value: 'weekly', label: 'Weekly' },
              { value: 'monthly', label: 'Monthly' },
            ]}
            value={form.values.auto_export}
            onChange={(value) => {
              form.setFieldValue('auto_export', value);
            }}
            disabled={!canWrite}
            data-testid="retention-auto-export"
          />
        </Stack>

        <Stack gap="xs">
          <Text size="sm" fw={500}>
            Export format
          </Text>
          <SegmentedControl<AutoExportFormat>
            data={[
              { value: 'csv', label: 'CSV' },
              { value: 'jsonl', label: 'JSONL' },
            ]}
            value={form.values.auto_export_format}
            onChange={(value) => {
              form.setFieldValue('auto_export_format', value);
            }}
            disabled={!canWrite || autoExportIsNever}
            data-testid="retention-auto-export-format"
          />
          {autoExportIsNever && (
            <Text size="xs">Format selection is ignored when auto-export is off.</Text>
          )}
        </Stack>

        <Group justify="flex-end" gap="sm">
          <Tooltip
            label="You don't have permission to edit retention settings"
            disabled={canWrite}
            withArrow
          >
            <span>
              <Button
                type="submit"
                loading={loading}
                disabled={!canWrite}
                data-testid="retention-save"
              >
                Save retention
              </Button>
            </span>
          </Tooltip>
        </Group>
      </Stack>
    </form>
  );
}
