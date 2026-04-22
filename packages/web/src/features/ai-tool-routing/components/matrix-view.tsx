/**
 * <MatrixView> — 2D grid of agents (rows) × tools (cols).
 *
 * Cell content rules:
 *   - No binding: blank with "+" hint on hover (click to create)
 *   - Binding exists + enabled: colored dot (green if no CEL, yellow if CEL)
 *   - Binding exists + disabled: gray dot
 *
 * Capped at 50 × 50 to keep the initial render responsive. Filter the agent
 * / tool lists above to narrow when tenant is large.
 */
import { useMemo } from 'react';
import { ActionIcon, Alert, Table, Text, Tooltip } from '@mantine/core';
import { IconInfoCircle, IconPlus } from '@tabler/icons-react';
import { useMockStore } from '@/api/mock-store';
import type { AiAgent, AiTool, AiToolBinding } from '@/api/resources/types';
import type { BindingFilter } from '../types';

interface MatrixViewProps {
  tenantId: string;
  filter: BindingFilter;
  onCellClick: (args: { agent: AiAgent; tool: AiTool; binding?: AiToolBinding }) => void;
}

const MAX_AGENTS = 50;
const MAX_TOOLS = 50;

function dotColor(binding: AiToolBinding | undefined): { bg: string; label: string } | null {
  if (!binding) return null;
  if (!binding.enabled) {
    return { bg: 'var(--mantine-color-gray-5)', label: 'Disabled' };
  }
  if (binding.condition.trim() !== '') {
    return {
      bg: 'var(--mantine-color-yellow-6)',
      label: 'Enabled (conditional)',
    };
  }
  return { bg: 'var(--mantine-color-green-6)', label: 'Enabled' };
}

export function MatrixView({ tenantId, filter, onCellClick }: MatrixViewProps) {
  const agentsRec = useMockStore((s) => s.aiAgents);
  const toolsRec = useMockStore((s) => s.aiTools);
  const bindingsRec = useMockStore((s) => s.aiToolBindings);

  const allAgents = useMemo(() => {
    const out = Object.values(agentsRec).filter((a) => a.tenant_id === tenantId);
    if (filter.agent_ids.length > 0) {
      return out.filter((a) => filter.agent_ids.includes(a.id));
    }
    return out;
  }, [agentsRec, tenantId, filter.agent_ids]);

  const allTools = useMemo(() => {
    const out = Object.values(toolsRec).filter((t) => t.tenant_id === tenantId);
    if (filter.tool_ids.length > 0) {
      return out.filter((t) => filter.tool_ids.includes(t.id));
    }
    return out;
  }, [toolsRec, tenantId, filter.tool_ids]);

  const agents = allAgents.slice(0, MAX_AGENTS);
  const tools = allTools.slice(0, MAX_TOOLS);

  /** bindings keyed by `${agent_id}::${tool_id}`. */
  const bindingByKey = useMemo(() => {
    const m = new Map<string, AiToolBinding>();
    for (const b of Object.values(bindingsRec)) {
      if (b.tenant_id !== tenantId) continue;
      // Apply the same condition/enabled filters used by the list view so the
      // visible dots match the list's filter output.
      if (filter.enabled !== undefined && b.enabled !== filter.enabled) continue;
      if (filter.has_condition !== undefined) {
        const has = b.condition.trim().length > 0;
        if (has !== filter.has_condition) continue;
      }
      m.set(`${b.agent_id}::${b.tool_id}`, b);
    }
    return m;
  }, [bindingsRec, tenantId, filter.enabled, filter.has_condition]);

  const capped = allAgents.length > MAX_AGENTS || allTools.length > MAX_TOOLS;

  if (agents.length === 0 || tools.length === 0) {
    return (
      <Alert variant="light" color="gray" icon={<IconInfoCircle size={16} />}>
        Matrix needs at least one agent and one tool for this tenant.
      </Alert>
    );
  }

  return (
    <div>
      {capped && (
        <Alert variant="light" color="yellow" icon={<IconInfoCircle size={16} />} mb="sm">
          Showing first {String(agents.length)} of {String(allAgents.length)} agents and{' '}
          {String(tools.length)} of {String(allTools.length)} tools. Filter above to narrow.
        </Alert>
      )}
      <div
        style={{
          overflowX: 'auto',
          border: '1px solid var(--mantine-color-gray-3)',
          borderRadius: 4,
        }}
      >
        <Table withColumnBorders withRowBorders striped aria-label="Agent × tool binding matrix">
          <Table.Thead>
            <Table.Tr>
              <Table.Th
                style={{
                  position: 'sticky',
                  left: 0,
                  background: 'var(--mantine-color-body)',
                  zIndex: 1,
                  minWidth: 160,
                }}
              >
                <Text size="xs" fw={600}>
                  Agent ╲ Tool
                </Text>
              </Table.Th>
              {tools.map((t) => (
                <Table.Th key={t.id} style={{ minWidth: 60 }}>
                  <Text
                    size="xs"
                    ff="monospace"
                    style={{
                      writingMode: 'vertical-rl',
                      transform: 'rotate(180deg)',
                      whiteSpace: 'nowrap',
                    }}
                    title={t.name}
                  >
                    {t.name}
                  </Text>
                </Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {agents.map((a) => (
              <Table.Tr key={a.id}>
                <Table.Th
                  style={{
                    position: 'sticky',
                    left: 0,
                    background: 'var(--mantine-color-body)',
                    zIndex: 1,
                  }}
                >
                  <Text size="xs" ff="monospace" fw={500}>
                    {a.name}
                  </Text>
                </Table.Th>
                {tools.map((t) => {
                  const binding = bindingByKey.get(`${a.id}::${t.id}`);
                  const dot = dotColor(binding);
                  const cellLabel = `${a.name} × ${t.name}`;
                  const tooltip = binding
                    ? `${cellLabel} · ${dot?.label ?? ''}${
                        binding.condition.trim() !== ''
                          ? ` · CEL: ${binding.condition.slice(0, 40)}`
                          : ''
                      }`
                    : `${cellLabel} · Click to create`;
                  return (
                    <Table.Td
                      key={t.id}
                      style={{
                        textAlign: 'center',
                        padding: 4,
                        cursor: 'pointer',
                      }}
                      onClick={() => {
                        onCellClick({ agent: a, tool: t, ...(binding ? { binding } : {}) });
                      }}
                    >
                      <Tooltip label={tooltip} withinPortal>
                        {binding ? (
                          <div
                            role="img"
                            aria-label={tooltip}
                            style={{
                              display: 'inline-block',
                              width: 14,
                              height: 14,
                              borderRadius: '50%',
                              background: dot?.bg ?? 'transparent',
                            }}
                          />
                        ) : (
                          <ActionIcon
                            variant="subtle"
                            size="sm"
                            aria-label={`Create binding for ${cellLabel}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onCellClick({ agent: a, tool: t });
                            }}
                          >
                            <IconPlus size={12} />
                          </ActionIcon>
                        )}
                      </Tooltip>
                    </Table.Td>
                  );
                })}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </div>
    </div>
  );
}
