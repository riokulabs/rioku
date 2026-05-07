/**
 * <ToolAuditTab> — recent audit entries for a single AI tool.
 *
 * Reads from /api/v1/t/{tenant}/audit?resource_type=ai-tool&resource_id={id}
 * via `useToolAudit`. If the daemon does not implement resource-filtered
 * audit yet, the hook returns an empty list and the UI shows an empty state.
 */
import { Stack, Table, Text } from '@mantine/core';
import dayjs from 'dayjs';
import { useToolAudit } from '../api';

interface ToolAuditTabProps {
  tenant: string;
  toolId: string;
}

export function ToolAuditTab({ tenant, toolId }: ToolAuditTabProps) {
  const { items } = useToolAudit(tenant, toolId);

  if (items.length === 0) {
    return (
      <Stack gap="xs">
        <Text size="sm" c="var(--mantine-color-gray-7)">
          No audit entries for this tool yet.
        </Text>
      </Stack>
    );
  }

  return (
    <Table striped highlightOnHover>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Action</Table.Th>
          <Table.Th>Actor</Table.Th>
          <Table.Th>When</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {items.map((e) => (
          <Table.Tr key={e.id}>
            <Table.Td>
              <Text size="xs" ff="monospace">
                {e.action}
              </Text>
            </Table.Td>
            <Table.Td>
              <Text size="xs">{e.actor_id}</Text>
            </Table.Td>
            <Table.Td>
              <Text size="xs">{dayjs(e.at).format('MMM D, HH:mm:ss')}</Text>
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
