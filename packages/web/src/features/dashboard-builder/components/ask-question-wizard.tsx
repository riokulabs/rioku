/**
 * <AskQuestionWizard> — Metabase-style 4-step widget wizard.
 *
 *  Step 1: Data source  — pick from 6 built-in + any plugin sources
 *  Step 2: Visualization — pick widget type (filtered by source compat)
 *  Step 3: Dimensions + measures — dynamic wizard_state form
 *  Step 4: Preview — live-render via <WidgetRenderer>
 *
 * Modes:
 *  - 'create': Save button calls `addWidget(dashboardId, …)`.
 *  - 'edit'  : Save button calls `updateWidget(widget.id, …)`; pre-fills
 *              fields from the existing widget (kind, data_source, title,
 *              wizard_state).
 *
 * Per-step Next validates only that step's fields (same pattern as Plan 2c
 * SiteCreateWizard). The final `handleSave` is the only place where a full
 * schema parse runs; any cross-step issue sends the user back to the
 * earliest invalid step.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Button,
  Card,
  Divider,
  Grid,
  Group,
  NumberInput,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Stepper,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from '@mantine/core';
import { IconAlertCircle, IconPlus, IconTrash } from '@tabler/icons-react';
import { WidgetRenderer } from '@/components/widget-renderer';
import { BUILT_IN_WIDGETS } from '@/features/widgets/registry';
import { DATA_SOURCE_ADAPTERS } from '@/features/widgets/data-sources';
import type { Widget, WidgetWizardState } from '@/api/resources/types';
import type { WidgetTypeDefinition } from '@/features/widgets/types';
import { addWidget, updateWidget, useWidgetData } from '../api';
import type { AskQuestionWizardProps, DataSourceDescriptor, WizardDraft } from '../types';

// ─── Data source catalog ──────────────────────────────────────────────────────

const SOURCE_HELP: Record<string, string> = {
  audit: 'Audit log entries — every write and sensitive action.',
  services: 'Upstream service registry records.',
  routes: 'Route table (method + path + service binding).',
  traces: 'AI trace log (prompt + completion + tokens).',
  notifications: 'Notification center entries.',
  mock: 'Deterministic synthetic rows — useful for testing widget rendering.',
};

/** Fields available per data source — hardcoded catalog for wizard UX. */
const SOURCE_FIELDS: Record<string, string[]> = {
  audit: ['actor_id', 'action', 'resource_type', 'resource_id', 'outcome', 'tier', 'at'],
  services: ['id', 'name', 'status', 'upstream_host', 'tenant_id'],
  routes: ['id', 'path', 'method', 'service_id', 'priority'],
  traces: ['id', 'agent_id', 'provider', 'model', 'tokens_total', 'at'],
  notifications: ['id', 'user_id', 'category', 'title', 'read', 'created_at'],
  mock: ['x', 'y', 'label'],
};

const AGGREGATIONS = ['count', 'sum', 'avg', 'min', 'max'] as const;
const FILTER_OPS = ['==', '!=', '>', '<', 'in', 'contains'] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function draftFromWidget(widget: Widget | null): WizardDraft {
  if (!widget) {
    return {
      title: '',
      kind: '',
      data_source: '',
      wizard_state: emptyWizardState(),
    };
  }
  return {
    title: widget.title,
    kind: widget.kind,
    data_source: widget.data_source,
    wizard_state: widget.wizard_state ?? emptyWizardState(),
  };
}

function emptyWizardState(): WidgetWizardState {
  return {
    dimensions: [],
    measures: [],
    filters: [],
  };
}

/** Stringify a filter's `value` without triggering `[object Object]` output. */
function filterValueAsString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v === null || v === undefined) return '';
  return '';
}

function dataSourceOptions(
  pluginSources: readonly DataSourceDescriptor[],
): { value: string; label: string; description: string }[] {
  const out: { value: string; label: string; description: string }[] = [];
  for (const key of Object.keys(DATA_SOURCE_ADAPTERS)) {
    out.push({
      value: key,
      label: key.charAt(0).toUpperCase() + key.slice(1),
      description: SOURCE_HELP[key] ?? '',
    });
  }
  for (const plugin of pluginSources) {
    out.push({
      value: plugin.id,
      label: plugin.label,
      description: plugin.description,
    });
  }
  return out;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AskQuestionWizard({
  dashboardId,
  widget,
  mode,
  onSave,
  onCancel,
}: AskQuestionWizardProps) {
  const [active, setActive] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<WizardDraft>(() => draftFromWidget(widget ?? null));

  // Plugin-registered widgets don't currently declare their data-source
  // compatibility (plan-1 contract), so the wizard only surfaces the 6
  // built-in data sources. Extending plugin registration is tracked in
  // Plan 5.
  const pluginSources = useMemo<DataSourceDescriptor[]>(() => [], []);

  const sourceOptions = useMemo(() => dataSourceOptions(pluginSources), [pluginSources]);

  const availableFields = useMemo(() => {
    if (draft.data_source === '') return [];
    return SOURCE_FIELDS[draft.data_source] ?? ['id'];
  }, [draft.data_source]);

  // Visualization options compatible with the chosen data source.
  const vizOptions = useMemo(() => {
    if (draft.data_source === '') return [];
    return Object.values(BUILT_IN_WIDGETS).filter((def) => {
      if (def.supportedDataSources === 'any') return true;
      return def.supportedDataSources.includes(draft.data_source);
    });
  }, [draft.data_source]);

  const validateStep = useCallback(
    (step: number): string | null => {
      if (step === 0 && draft.data_source === '') {
        return 'Pick a data source to continue.';
      }
      if (step === 1 && draft.kind === '') {
        return 'Pick a visualization to continue.';
      }
      if (step === 2 && draft.title.trim() === '') {
        return 'Give the widget a title before previewing.';
      }
      return null;
    },
    [draft.data_source, draft.kind, draft.title],
  );

  const handleNext = useCallback(() => {
    const err = validateStep(active);
    if (err !== null) {
      setError(err);
      return;
    }
    setError(null);
    setActive((s) => Math.min(3, s + 1));
  }, [active, validateStep]);

  const handleBack = useCallback(() => {
    setError(null);
    setActive((s) => Math.max(0, s - 1));
  }, []);

  const handleSave = useCallback(async () => {
    for (let s = 0; s < 3; s += 1) {
      const err = validateStep(s);
      if (err !== null) {
        setError(err);
        setActive(s);
        return;
      }
    }
    setSubmitting(true);
    setError(null);
    try {
      const saved =
        mode === 'edit' && widget
          ? await updateWidget(widget.id, {
              title: draft.title.trim(),
              kind: draft.kind,
              data_source: draft.data_source,
              wizard_state: draft.wizard_state,
            })
          : await addWidget(dashboardId, {
              kind: draft.kind,
              title: draft.title.trim(),
              data_source: draft.data_source,
              wizard_state: draft.wizard_state,
            });
      onSave(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save widget');
    } finally {
      setSubmitting(false);
    }
  }, [dashboardId, draft, mode, widget, onSave, validateStep]);

  return (
    <Stack gap="md">
      {error !== null && (
        <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
          {error}
        </Alert>
      )}

      <Stepper
        active={active}
        onStepClick={(idx) => {
          if (idx < active) setActive(idx);
          else {
            let ok = true;
            for (let s = active; s < idx; s += 1) {
              const err = validateStep(s);
              if (err !== null) {
                setError(err);
                setActive(s);
                ok = false;
                break;
              }
            }
            if (ok) setActive(idx);
          }
        }}
        size="sm"
      >
        <Stepper.Step label="Data" description="Pick a source">
          <StepDataSource
            sourceOptions={sourceOptions}
            value={draft.data_source}
            onChange={(v) => {
              setDraft((d) => ({ ...d, data_source: v, kind: '' }));
            }}
          />
        </Stepper.Step>
        <Stepper.Step label="Viz" description="Pick a chart">
          <StepVisualization
            options={vizOptions}
            value={draft.kind}
            onChange={(v) => {
              setDraft((d) => ({ ...d, kind: v }));
            }}
          />
        </Stepper.Step>
        <Stepper.Step label="Query" description="Dimensions + measures">
          <StepQuery
            draft={draft}
            availableFields={availableFields}
            onChange={(next) => {
              setDraft(next);
            }}
          />
        </Stepper.Step>
        <Stepper.Completed>
          <StepPreview draft={draft} dashboardId={dashboardId} />
        </Stepper.Completed>
      </Stepper>

      <Group justify="space-between">
        <Button
          variant="default"
          onClick={active === 0 ? onCancel : handleBack}
          disabled={submitting}
        >
          {active === 0 ? 'Cancel' : 'Back'}
        </Button>
        {active < 3 ? (
          <Button onClick={handleNext}>Next</Button>
        ) : (
          <Button
            loading={submitting}
            data-testid="wizard-save"
            onClick={() => {
              void handleSave();
            }}
          >
            {mode === 'edit' ? 'Save widget' : 'Create widget'}
          </Button>
        )}
      </Group>
    </Stack>
  );
}

// ─── Step 1: Data source ──────────────────────────────────────────────────────

interface StepDataSourceProps {
  sourceOptions: { value: string; label: string; description: string }[];
  value: string;
  onChange: (next: string) => void;
}

function StepDataSource({ sourceOptions, value, onChange }: StepDataSourceProps) {
  return (
    <Stack gap="sm" mt="md">
      <Title order={5}>Choose a data source</Title>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
        {sourceOptions.map((opt) => (
          <Card
            key={opt.value}
            withBorder
            radius="md"
            p="sm"
            onClick={() => {
              onChange(opt.value);
            }}
            aria-label={`Select data source ${opt.label}`}
            aria-pressed={value === opt.value}
            data-testid={`source-${opt.value}`}
            style={{
              cursor: 'pointer',
              outline: value === opt.value ? '2px solid var(--mantine-color-blue-5)' : 'none',
              outlineOffset: '-2px',
            }}
          >
            <Stack gap={2}>
              <Text size="sm" fw={600}>
                {opt.label}
              </Text>
              <Text size="xs" c="var(--mantine-color-gray-7)">
                {opt.description}
              </Text>
            </Stack>
          </Card>
        ))}
      </SimpleGrid>
    </Stack>
  );
}

// ─── Step 2: Visualization ────────────────────────────────────────────────────

interface StepVisualizationProps {
  options: WidgetTypeDefinition[];
  value: string;
  onChange: (next: string) => void;
}

function StepVisualization({ options, value, onChange }: StepVisualizationProps) {
  return (
    <Stack gap="sm" mt="md">
      <Title order={5}>Choose a visualization</Title>
      {options.length === 0 ? (
        <Text size="sm" c="var(--mantine-color-gray-7)">
          No visualizations compatible with the selected data source.
        </Text>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          {options.map((def) => (
            <Card
              key={def.type}
              withBorder
              radius="md"
              p="sm"
              onClick={() => {
                onChange(def.type);
              }}
              aria-label={`Select visualization ${def.displayName}`}
              aria-pressed={value === def.type}
              data-testid={`viz-${def.type}`}
              style={{
                cursor: 'pointer',
                outline: value === def.type ? '2px solid var(--mantine-color-blue-5)' : 'none',
                outlineOffset: '-2px',
              }}
            >
              <Stack gap={2}>
                <Text size="sm" fw={600}>
                  {def.displayName}
                </Text>
                <Text size="xs" c="var(--mantine-color-gray-7)">
                  {def.description}
                </Text>
              </Stack>
            </Card>
          ))}
        </SimpleGrid>
      )}
    </Stack>
  );
}

// ─── Step 3: Query ────────────────────────────────────────────────────────────

interface StepQueryProps {
  draft: WizardDraft;
  availableFields: string[];
  onChange: (next: WizardDraft) => void;
}

function StepQuery({ draft, availableFields, onChange }: StepQueryProps) {
  const ws = draft.wizard_state;

  function setWs(next: WidgetWizardState) {
    onChange({ ...draft, wizard_state: next });
  }

  return (
    <Stack gap="md" mt="md">
      <TextInput
        label="Widget title"
        value={draft.title}
        onChange={(e) => {
          onChange({ ...draft, title: e.currentTarget.value });
        }}
        required
        data-testid="wizard-title"
      />

      <Divider label="Dimensions" labelPosition="left" />
      <Select
        label="Add dimension"
        placeholder="Pick a field"
        data={availableFields.filter((f) => !ws.dimensions.includes(f))}
        value={null}
        onChange={(v) => {
          if (v === null) return;
          setWs({ ...ws, dimensions: [...ws.dimensions, v] });
        }}
      />
      {ws.dimensions.length > 0 && (
        <Group gap="xs">
          {ws.dimensions.map((d, i) => (
            <Card key={`${d}-${String(i)}`} withBorder p={4} radius="sm">
              <Group gap={4} wrap="nowrap">
                <Text size="xs">{d}</Text>
                <ActionIcon
                  variant="subtle"
                  size="xs"
                  aria-label={`Remove dimension ${d}`}
                  onClick={() => {
                    setWs({
                      ...ws,
                      dimensions: ws.dimensions.filter((_, idx) => idx !== i),
                    });
                  }}
                >
                  <IconTrash size={12} />
                </ActionIcon>
              </Group>
            </Card>
          ))}
        </Group>
      )}

      <Divider label="Measures" labelPosition="left" />
      {ws.measures.map((m, i) => (
        <Grid key={i} align="flex-end">
          <Grid.Col span={{ base: 12, sm: 4 }}>
            <Select
              label="Field"
              data={availableFields}
              value={m.field}
              onChange={(v) => {
                const next = [...ws.measures];
                next[i] = { ...m, field: v ?? '' };
                setWs({ ...ws, measures: next });
              }}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 6, sm: 3 }}>
            <Select
              label="Aggregation"
              data={[...AGGREGATIONS]}
              value={m.aggregation}
              onChange={(v) => {
                if (v === null) return;
                const agg = AGGREGATIONS.find((a) => a === v);
                if (!agg) return;
                const next = [...ws.measures];
                next[i] = { ...m, aggregation: agg };
                setWs({ ...ws, measures: next });
              }}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 6, sm: 4 }}>
            <TextInput
              label="Alias (optional)"
              value={m.alias ?? ''}
              onChange={(e) => {
                const next = [...ws.measures];
                const { alias: _unused, ...rest } = m;
                void _unused;
                next[i] =
                  e.currentTarget.value === '' ? rest : { ...rest, alias: e.currentTarget.value };
                setWs({ ...ws, measures: next });
              }}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 1 }}>
            <ActionIcon
              variant="subtle"
              color="red.8"
              aria-label="Remove measure"
              onClick={() => {
                setWs({
                  ...ws,
                  measures: ws.measures.filter((_, idx) => idx !== i),
                });
              }}
            >
              <IconTrash size={14} />
            </ActionIcon>
          </Grid.Col>
        </Grid>
      ))}
      <Button
        variant="light"
        size="xs"
        leftSection={<IconPlus size={12} />}
        onClick={() => {
          setWs({
            ...ws,
            measures: [
              ...ws.measures,
              {
                field: availableFields[0] ?? 'id',
                aggregation: 'count',
              },
            ],
          });
        }}
        data-testid="wizard-add-measure"
      >
        Add measure
      </Button>

      <Divider label="Filters" labelPosition="left" />
      {ws.filters.map((f, i) => (
        <Grid key={i} align="flex-end">
          <Grid.Col span={{ base: 12, sm: 4 }}>
            <Select
              label="Field"
              data={availableFields}
              value={f.field}
              onChange={(v) => {
                const next = [...ws.filters];
                next[i] = { ...f, field: v ?? '' };
                setWs({ ...ws, filters: next });
              }}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 6, sm: 3 }}>
            <Select
              label="Operator"
              data={[...FILTER_OPS]}
              value={f.op}
              onChange={(v) => {
                if (v === null) return;
                const op = FILTER_OPS.find((o) => o === v);
                if (!op) return;
                const next = [...ws.filters];
                next[i] = { ...f, op };
                setWs({ ...ws, filters: next });
              }}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 6, sm: 4 }}>
            <TextInput
              label="Value"
              value={filterValueAsString(f.value)}
              onChange={(e) => {
                const next = [...ws.filters];
                next[i] = { ...f, value: e.currentTarget.value };
                setWs({ ...ws, filters: next });
              }}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 1 }}>
            <ActionIcon
              variant="subtle"
              color="red.8"
              aria-label="Remove filter"
              onClick={() => {
                setWs({
                  ...ws,
                  filters: ws.filters.filter((_, idx) => idx !== i),
                });
              }}
            >
              <IconTrash size={14} />
            </ActionIcon>
          </Grid.Col>
        </Grid>
      ))}
      <Button
        variant="light"
        size="xs"
        leftSection={<IconPlus size={12} />}
        onClick={() => {
          setWs({
            ...ws,
            filters: [
              ...ws.filters,
              {
                field: availableFields[0] ?? 'id',
                op: '==',
                value: '',
              },
            ],
          });
        }}
      >
        Add filter
      </Button>

      <Divider label="Grouping + sorting" labelPosition="left" />
      <Select
        label="Group by"
        placeholder="No grouping"
        data={ws.dimensions.length > 0 ? ws.dimensions : availableFields}
        value={ws.group_by ?? null}
        clearable
        onChange={(v) => {
          const { group_by: _g, ...rest } = ws;
          void _g;
          if (v === null || v === '') setWs(rest);
          else setWs({ ...rest, group_by: v });
        }}
      />
      <Group grow align="flex-end">
        <Select
          label="Order by"
          placeholder="Unsorted"
          data={availableFields}
          clearable
          value={ws.order_by?.field ?? null}
          onChange={(v) => {
            if (v === null) {
              const { order_by: _o, ...rest } = ws;
              void _o;
              setWs(rest);
              return;
            }
            setWs({
              ...ws,
              order_by: {
                field: v,
                direction: ws.order_by?.direction ?? 'asc',
              },
            });
          }}
        />
        <SegmentedControl
          value={ws.order_by?.direction ?? 'asc'}
          onChange={(v) => {
            if (!ws.order_by) return;
            setWs({
              ...ws,
              order_by: {
                ...ws.order_by,
                direction: v === 'desc' ? 'desc' : 'asc',
              },
            });
          }}
          data={[
            { value: 'asc', label: 'Asc' },
            { value: 'desc', label: 'Desc' },
          ]}
          disabled={!ws.order_by}
          aria-label="Order direction"
        />
      </Group>
      <NumberInput
        label="Limit"
        value={ws.limit ?? ''}
        min={1}
        max={10000}
        onChange={(v) => {
          const { limit: _l, ...rest } = ws;
          void _l;
          if (typeof v === 'number') setWs({ ...rest, limit: v });
          else setWs(rest);
        }}
      />
    </Stack>
  );
}

// ─── Step 4: Preview ──────────────────────────────────────────────────────────

interface StepPreviewProps {
  draft: WizardDraft;
  dashboardId: string;
}

function StepPreview({ draft, dashboardId }: StepPreviewProps) {
  // Construct a throwaway widget object so useWidgetData can be invoked.
  // The `id` is stable per render and carries no mutation semantics — it's
  // purely a cache key for `useWidgetData`.
  // Build a cache key from draft shape; lets the preview rebuild only when
  // the user changes fields that affect the query result.
  const wizardStateSig = JSON.stringify(draft.wizard_state);
  const previewWidget = useMemo<Widget>(
    () => ({
      id: `preview-${dashboardId}`,
      dashboard_id: dashboardId,
      kind: draft.kind === '' ? 'single-stat' : draft.kind,
      title: draft.title === '' ? 'Preview' : draft.title,
      config: {},
      position: { x: 0, y: 0, w: 4, h: 3 },
      data_source: draft.data_source === '' ? 'mock' : draft.data_source,
      raw_query: '',
      wizard_state: draft.wizard_state,
      locked_advanced: false,
      created_at: new Date().toISOString(),
      updated_at: new Date(wizardStateSig.length).toISOString(),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dashboardId, draft.data_source, draft.kind, draft.title, wizardStateSig],
  );

  const { data, loading, error } = useWidgetData(previewWidget);
  const rendererProps = {
    widget: previewWidget,
    data,
    loading,
    ...(error !== undefined ? { error } : {}),
  };

  return (
    <Stack gap="sm" mt="md">
      <Title order={5}>Preview</Title>
      <Card withBorder radius="md" p="md">
        <Stack gap="xs" style={{ minHeight: 220 }}>
          <Group gap="xs">
            <ThemeIcon variant="light" size="sm">
              <IconAlertCircle size={12} />
            </ThemeIcon>
            <Text size="xs" c="var(--mantine-color-gray-7)">
              Preview uses the current wizard state — it does not persist until you click Save.
            </Text>
          </Group>
          <div style={{ flex: 1, minHeight: 200 }}>
            <WidgetRenderer {...rendererProps} />
          </div>
        </Stack>
      </Card>
    </Stack>
  );
}
