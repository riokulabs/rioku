/**
 * <BindingFilterBar> — agent + tool multi-selects, enabled segmented control,
 * and has-condition segmented control for BindingList / MatrixView.
 */
import { Group, MultiSelect, SegmentedControl } from '@mantine/core';
import { useAgentRefs, useToolRefs } from '../refs';
import type { BindingFilter } from '../types';

interface BindingFilterBarProps {
  tenantId: string;
  filter: BindingFilter;
  onChange: (next: BindingFilter) => void;
}

export function BindingFilterBar({ tenantId, filter, onChange }: BindingFilterBarProps) {
  const { list: agents } = useAgentRefs(tenantId);
  const { list: tools } = useToolRefs(tenantId);

  const agentOptions = agents.map((a) => ({ value: a.id, label: a.name }));
  const toolOptions = tools.map((t) => ({ value: t.id, label: t.name }));

  const enabledValue = filter.enabled === undefined ? 'all' : filter.enabled ? 'on' : 'off';

  const conditionValue =
    filter.has_condition === undefined ? 'all' : filter.has_condition ? 'conditional' : 'uncond';

  return (
    <Group gap="sm" align="flex-end">
      <MultiSelect
        data={agentOptions}
        value={filter.agent_ids}
        onChange={(value) => {
          onChange({ ...filter, agent_ids: value });
        }}
        placeholder={filter.agent_ids.length === 0 ? 'All agents' : undefined}
        w={240}
        clearable
        searchable
        aria-label="Filter by agent"
      />
      <MultiSelect
        data={toolOptions}
        value={filter.tool_ids}
        onChange={(value) => {
          onChange({ ...filter, tool_ids: value });
        }}
        placeholder={filter.tool_ids.length === 0 ? 'All tools' : undefined}
        w={240}
        clearable
        searchable
        aria-label="Filter by tool"
      />
      <SegmentedControl
        data={[
          { value: 'all', label: 'All' },
          { value: 'on', label: 'Enabled' },
          { value: 'off', label: 'Disabled' },
        ]}
        value={enabledValue}
        onChange={(value) => {
          const next: BindingFilter = { ...filter };
          if (value === 'all') delete next.enabled;
          else next.enabled = value === 'on';
          onChange(next);
        }}
        aria-label="Filter by enabled"
      />
      <SegmentedControl
        data={[
          { value: 'all', label: 'Any' },
          { value: 'conditional', label: 'With CEL' },
          { value: 'uncond', label: 'No CEL' },
        ]}
        value={conditionValue}
        onChange={(value) => {
          const next: BindingFilter = { ...filter };
          if (value === 'all') delete next.has_condition;
          else next.has_condition = value === 'conditional';
          onChange(next);
        }}
        aria-label="Filter by CEL condition"
      />
    </Group>
  );
}
