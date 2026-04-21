/**
 * <TableWidget> — tabular rows with inferred columns.
 *
 * Expected data shape: { rows: Record<string, unknown>[]; columns?: string[] }.
 */
import { Alert, Badge, ScrollArea, Skeleton, Table, Text } from '@mantine/core';
import type { WidgetRenderProps } from '../types';

interface TableData {
  rows: Record<string, unknown>[];
  columns?: string[];
}

function isTableData(data: unknown): data is TableData {
  return (
    typeof data === 'object' &&
    data !== null &&
    Array.isArray((data as { rows?: unknown }).rows)
  );
}

/** Humanize a snake_case or camelCase column header. */
function humanizeHeader(s: string): string {
  return s
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Render a cell value with light type-aware formatting. */
function CellValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <Text size="xs" c="dimmed">—</Text>;
  }
  if (typeof value === 'boolean') {
    return (
      <Badge size="xs" variant="dot" color={value ? 'green' : 'gray'}>
        {value ? 'true' : 'false'}
      </Badge>
    );
  }
  if (typeof value === 'number') {
    return (
      <Text size="xs" fw={500} ff="monospace">
        {value.toLocaleString()}
      </Text>
    );
  }
  const str = typeof value === 'string' ? value : JSON.stringify(value);

  // Status / outcome colouring
  const statusColors: Record<string, string> = {
    success: 'green', active: 'green', enabled: 'green', healthy: 'green',
    error: 'red', failed: 'red', denied: 'red', critical: 'red',
    warning: 'yellow', warn: 'yellow', degraded: 'yellow',
    pending: 'blue', info: 'blue',
    disabled: 'gray', inactive: 'gray',
  };
  const lower = str.toLowerCase();
  const color = statusColors[lower];
  if (color !== undefined) {
    return (
      <Badge size="xs" variant="light" color={color}>
        {str}
      </Badge>
    );
  }

  return <Text size="xs">{str}</Text>;
}

export function TableWidget({ widget, data, loading, error }: WidgetRenderProps) {
  if (loading) return <Skeleton height={200} width="100%" radius="sm" />;
  if (error)
    return (
      <Alert color="red" title="Widget error" variant="light">
        {error}
      </Alert>
    );
  if (!isTableData(data))
    return (
      <Alert color="yellow" title="Invalid data" variant="light">
        Expected {'{ rows: [] }'}
      </Alert>
    );

  const columns = data.columns ?? (data.rows.length > 0 ? Object.keys(data.rows[0] ?? {}) : []);

  if (data.rows.length === 0) {
    return (
      <Text size="sm" c="dimmed" ta="center" py="md">
        No data
      </Text>
    );
  }

  return (
    <ScrollArea.Autosize mah={260} aria-label={`Table for ${widget.title}`} style={{ maxWidth: '100%' }}>
      <Table
        striped
        highlightOnHover
        withTableBorder
        withColumnBorders
        style={{ minWidth: 'max-content', fontSize: 12 }}
      >
        <Table.Thead>
          <Table.Tr>
            {columns.map((c) => (
              <Table.Th key={c} style={{ whiteSpace: 'nowrap', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {humanizeHeader(c)}
              </Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {data.rows.map((row, ri) => (
            <Table.Tr key={ri}>
              {columns.map((c) => (
                <Table.Td key={c} style={{ whiteSpace: 'nowrap' }}>
                  <CellValue value={row[c]} />
                </Table.Td>
              ))}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </ScrollArea.Autosize>
  );
}
