/**
 * <ToolsTab> — list of AI tools exposed by an MCP server.
 *
 * Each row shows the tool name (monospace), its description, and a short
 * preview of the JSON-schema for its input arguments. The full schema is
 * available via a "Show schema" toggle.
 */
import { Fragment, useState } from 'react';
import { Alert, Badge, Card, Code, Collapse, Group, Stack, Table, Text } from '@mantine/core';
import { IconAlertCircle, IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import { useMcpServerTools } from '../api';

interface ToolsTabProps {
  tenant: string;
  serverId: string;
}

const SCHEMA_PREVIEW_MAX = 80;

function previewSchema(raw: string | undefined): string {
  if (!raw) return '—';
  // Try to parse + extract top-level property names; fall back to a truncated
  // raw string when parsing fails (the daemon stores schema as opaque JSON).
  try {
    const parsed = JSON.parse(raw) as { properties?: Record<string, unknown>; type?: string };
    if (parsed.properties && typeof parsed.properties === 'object') {
      const keys = Object.keys(parsed.properties);
      if (keys.length === 0) return parsed.type ?? 'object';
      const head = keys.slice(0, 4).join(', ');
      const more = keys.length > 4 ? ` +${String(keys.length - 4)}` : '';
      return `{ ${head}${more} }`;
    }
    if (parsed.type) return parsed.type;
  } catch {
    /* fallthrough */
  }
  return raw.length > SCHEMA_PREVIEW_MAX ? `${raw.slice(0, SCHEMA_PREVIEW_MAX)}…` : raw;
}

export function ToolsTab({ tenant, serverId }: ToolsTabProps) {
  const { items, isLoading, error } = useMcpServerTools(tenant, serverId);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (isLoading) {
    return <Text size="sm">Loading tools…</Text>;
  }
  if (error) {
    return (
      <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
        Failed to load tools.
      </Alert>
    );
  }
  if (items.length === 0) {
    return (
      <Card withBorder padding="md">
        <Text size="sm" c="var(--mantine-color-gray-7)">
          This MCP server has not exposed any tools yet. Tools are populated as the server reports
          them — try running a connectivity probe.
        </Text>
      </Card>
    );
  }

  return (
    <Card withBorder padding={0}>
      <Table striped highlightOnHover verticalSpacing="sm" data-testid="mcp-tools-table">
        <Table.Thead>
          <Table.Tr>
            <Table.Th style={{ width: 32 }} />
            <Table.Th>Name</Table.Th>
            <Table.Th>Description</Table.Th>
            <Table.Th>Args (preview)</Table.Th>
            <Table.Th style={{ width: 110 }}>Flags</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {items.map((t) => {
            const isOpen = expanded[t.id] ?? false;
            const raw = t.argSchema ?? '';
            return (
              <Fragment key={t.id}>
                <Table.Tr
                  style={{ cursor: raw ? 'pointer' : undefined }}
                  onClick={() => {
                    if (!raw) return;
                    setExpanded((prev) => ({ ...prev, [t.id]: !isOpen }));
                  }}
                  data-testid={`mcp-tool-row-${t.id}`}
                >
                  <Table.Td>
                    {raw ? (
                      isOpen ? (
                        <IconChevronDown size={14} />
                      ) : (
                        <IconChevronRight size={14} />
                      )
                    ) : null}
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" ff="monospace" fw={500}>
                      {t.name}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c="var(--mantine-color-gray-7)" lineClamp={2}>
                      {t.description ?? '—'}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Code data-testid={`mcp-tool-args-preview-${t.id}`}>{previewSchema(raw)}</Code>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4}>
                      {t.dangerous && (
                        <Badge size="xs" color="red" variant="light">
                          dangerous
                        </Badge>
                      )}
                      {t.enabled === false && (
                        <Badge size="xs" color="gray" variant="light">
                          disabled
                        </Badge>
                      )}
                    </Group>
                  </Table.Td>
                </Table.Tr>
                {raw && (
                  <Table.Tr>
                    <Table.Td colSpan={5} p={0}>
                      <Collapse expanded={isOpen}>
                        <Stack
                          gap="xs"
                          p="md"
                          bg="var(--mantine-color-dark-7)"
                          data-testid={`mcp-tool-schema-${t.id}`}
                        >
                          <Text size="xs" fw={600}>
                            Argument schema (JSON)
                          </Text>
                          <Code block style={{ whiteSpace: 'pre-wrap' }}>
                            {raw}
                          </Code>
                        </Stack>
                      </Collapse>
                    </Table.Td>
                  </Table.Tr>
                )}
              </Fragment>
            );
          })}
        </Table.Tbody>
      </Table>
    </Card>
  );
}
