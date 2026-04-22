/**
 * <VariablesPanel> — Grafana-mode dashboard variables editor.
 *
 * CRUD over `dashboard.variables` (persisted via `updateDashboard`):
 *
 *   - Table-style list with inline-edit of name / kind / default / options.
 *   - Add button reveals a blank row.
 *   - Delete removes a row.
 *   - Visible + editable only when `dashboard.mode === 'grafana'`; other
 *     modes render an explanatory empty state with "Switch to Grafana to
 *     enable" chrome.
 *
 * Queries reference variables as `$name` — see `substituteVariables` in
 * `@/features/widgets/data-sources`. This panel does not run queries.
 */
import { useCallback, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Group,
  Select,
  Stack,
  Table,
  TagsInput,
  Text,
  TextInput,
  ActionIcon,
  Tooltip,
} from '@mantine/core';
import { IconAlertCircle, IconPlus, IconTrash, IconVariable } from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import { usePermission } from '@/hooks/use-permission';
import type { Dashboard, DashboardVariable } from '@/api/resources/types';
import { updateDashboard } from '../api';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface VariablesPanelProps {
  dashboard: Dashboard;
  /** Called after a successful save. Caller decides whether to refresh state. */
  onSaved?: (dashboard: Dashboard) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VARIABLE_KINDS: DashboardVariable['kind'][] = ['text', 'enum', 'interval'];

function isDuplicateName(vars: DashboardVariable[], name: string, selfIdx: number): boolean {
  return vars.some((v, i) => i !== selfIdx && v.name === name);
}

// ─── Component ────────────────────────────────────────────────────────────────

export function VariablesPanel({ dashboard, onSaved }: VariablesPanelProps) {
  const canWrite = usePermission('dashboard:write');
  const [draft, setDraft] = useState<DashboardVariable[]>(dashboard.variables);
  const [saving, setSaving] = useState(false);

  const dirty = JSON.stringify(draft) !== JSON.stringify(dashboard.variables);

  const handleAdd = useCallback(() => {
    setDraft((prev) => [...prev, { name: '', kind: 'text', default: '' }]);
  }, []);

  const handleRemove = useCallback((idx: number) => {
    setDraft((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handleUpdate = useCallback((idx: number, patch: Partial<DashboardVariable>) => {
    setDraft((prev) => prev.map((v, i) => (i === idx ? { ...v, ...patch } : v)));
  }, []);

  const handleSave = useCallback(async () => {
    // Validate: non-empty unique names.
    for (let i = 0; i < draft.length; i++) {
      const v = draft[i];
      if (!v) continue;
      if (v.name.trim() === '') {
        notify.error('Invalid variable', `Row ${String(i + 1)} is missing a name.`);
        return;
      }
      if (isDuplicateName(draft, v.name, i)) {
        notify.error('Duplicate variable', `"${v.name}" is defined more than once.`);
        return;
      }
      if (v.kind === 'enum' && (!v.options || v.options.length === 0)) {
        notify.error('Invalid enum', `"${v.name}" is an enum but has no options.`);
        return;
      }
    }

    setSaving(true);
    try {
      const updated = await updateDashboard(dashboard.id, {
        variables: draft,
      });
      notify.success('Variables saved', 'Dashboard variables updated.');
      onSaved?.(updated);
    } catch (e) {
      notify.error('Save failed', (e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [draft, dashboard.id, onSaved]);

  // Non-Grafana mode is a read-only empty state.
  if (dashboard.mode !== 'grafana') {
    return (
      <Stack gap="sm" p="sm" data-testid="variables-panel">
        <Group gap="xs" align="center">
          <IconVariable size={18} />
          <Text fw={600}>Dashboard variables</Text>
        </Group>
        <Alert color="blue" variant="light" icon={<IconAlertCircle size={16} />}>
          <Text size="sm">
            Variables are only used in Grafana mode. Switch this dashboard to Grafana mode to define{' '}
            <Text component="span" ff="monospace">
              $name
            </Text>{' '}
            substitutions inside raw queries.
          </Text>
        </Alert>
      </Stack>
    );
  }

  return (
    <Stack gap="sm" p="sm" data-testid="variables-panel">
      <Group justify="space-between" align="center">
        <Group gap="xs" align="center">
          <IconVariable size={18} />
          <Text fw={600}>Dashboard variables</Text>
          <Badge size="sm" variant="light" color="violet">
            grafana mode
          </Badge>
        </Group>
        <Group gap="xs">
          <Button
            size="xs"
            variant="default"
            leftSection={<IconPlus size={14} />}
            disabled={!canWrite}
            onClick={handleAdd}
            data-testid="variables-panel-add"
          >
            Add variable
          </Button>
          <Button
            size="xs"
            loading={saving}
            disabled={!canWrite || !dirty}
            onClick={() => {
              void handleSave();
            }}
            data-testid="variables-panel-save"
          >
            Save
          </Button>
        </Group>
      </Group>

      {draft.length === 0 ? (
        <Alert color="gray" variant="light" icon={<IconAlertCircle size={16} />}>
          <Text size="sm">
            No variables yet. Add one to reference as{' '}
            <Text component="span" ff="monospace">
              $name
            </Text>{' '}
            inside raw queries.
          </Text>
        </Alert>
      ) : (
        <Table withTableBorder withColumnBorders striped="odd" stickyHeader>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={{ width: 160 }}>Name</Table.Th>
              <Table.Th style={{ width: 120 }}>Kind</Table.Th>
              <Table.Th style={{ width: 180 }}>Default</Table.Th>
              <Table.Th>Options (enum only)</Table.Th>
              <Table.Th style={{ width: 48 }} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {draft.map((v, idx) => (
              <Table.Tr key={idx} data-testid={`variables-panel-row-${String(idx)}`}>
                <Table.Td>
                  <TextInput
                    size="xs"
                    placeholder="tenant"
                    value={v.name}
                    aria-label={`Variable ${String(idx + 1)} name`}
                    onChange={(e) => {
                      handleUpdate(idx, { name: e.currentTarget.value });
                    }}
                  />
                </Table.Td>
                <Table.Td>
                  <Select
                    size="xs"
                    data={VARIABLE_KINDS.map((k) => ({ value: k, label: k }))}
                    value={v.kind}
                    onChange={(next) => {
                      if (next === null) return;
                      const kind = VARIABLE_KINDS.find((k) => k === next);
                      if (kind === undefined) return;
                      handleUpdate(idx, { kind });
                    }}
                    aria-label={`Variable ${String(idx + 1)} kind`}
                  />
                </Table.Td>
                <Table.Td>
                  <TextInput
                    size="xs"
                    placeholder="default value"
                    value={v.default}
                    aria-label={`Variable ${String(idx + 1)} default`}
                    onChange={(e) => {
                      handleUpdate(idx, { default: e.currentTarget.value });
                    }}
                  />
                </Table.Td>
                <Table.Td>
                  {v.kind === 'enum' ? (
                    <TagsInput
                      size="xs"
                      placeholder="add option…"
                      value={v.options ?? []}
                      aria-label={`Variable ${String(idx + 1)} options`}
                      onChange={(options) => {
                        handleUpdate(idx, { options });
                      }}
                    />
                  ) : (
                    <Text size="xs" c="var(--mantine-color-gray-7)">
                      —
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  <Tooltip label="Remove variable" withArrow>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      disabled={!canWrite}
                      onClick={() => {
                        handleRemove(idx);
                      }}
                      aria-label={`Remove variable ${String(idx + 1)}`}
                    >
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Tooltip>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
}
