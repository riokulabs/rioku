/**
 * <TableWidget> — tabular rows with inferred columns.
 *
 * Expected data shape: { rows: Record<string, unknown>[]; columns?: string[] }.
 */
import { Alert, ScrollArea, Skeleton, Table } from '@mantine/core';
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

  return (
    <ScrollArea.Autosize mah={240} aria-label={`Table for ${widget.title}`}>
      <Table striped withTableBorder>
        <Table.Thead>
          <Table.Tr>
            {columns.map((c) => (
              <Table.Th key={c}>{c}</Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {data.rows.map((row, ri) => (
            <Table.Tr key={ri}>
              {columns.map((c) => {
                const v = row[c];
                let rendered = '';
                if (typeof v === 'string') rendered = v;
                else if (typeof v === 'number' || typeof v === 'boolean') rendered = String(v);
                else if (v !== null && v !== undefined) rendered = JSON.stringify(v);
                return <Table.Td key={c}>{rendered}</Table.Td>;
              })}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </ScrollArea.Autosize>
  );
}
