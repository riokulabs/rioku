/**
 * pagination.tsx — Pagination controls for <DataTable>.
 *
 * Renders Mantine's <Pagination> component with a page-size selector.
 * Syncs with TanStack Table's pagination state.
 */

import { Group, Pagination, Select, Text } from '@mantine/core';
import type { Table } from '@tanstack/react-table';

const PAGE_SIZE_OPTIONS = [
  { value: '10', label: '10 / page' },
  { value: '25', label: '25 / page' },
  { value: '50', label: '50 / page' },
  { value: '100', label: '100 / page' },
];

export interface DataTablePaginationProps<TData> {
  table: Table<TData>;
  totalRows: number;
}

export function DataTablePagination<TData>({
  table,
  totalRows,
}: DataTablePaginationProps<TData>) {
  const { pageIndex, pageSize } = table.getState().pagination;
  const pageCount = table.getPageCount();

  const startRow = pageIndex * pageSize + 1;
  const endRow = Math.min((pageIndex + 1) * pageSize, totalRows);

  return (
    <Group justify="space-between" align="center" py="xs" px="sm">
      <Text size="sm" c="dimmed" aria-live="polite">
        {totalRows === 0
          ? 'No results'
          : `Showing ${String(startRow)}–${String(endRow)} of ${String(totalRows)}`}
      </Text>

      <Group gap="sm" align="center">
        <Select
          data={PAGE_SIZE_OPTIONS}
          value={String(pageSize)}
          onChange={(value) => {
            if (value) {
              table.setPageSize(Number(value));
              table.setPageIndex(0);
            }
          }}
          size="xs"
          w={110}
          aria-label="Rows per page"
          allowDeselect={false}
        />

        <Pagination
          total={pageCount}
          value={pageIndex + 1}
          onChange={(page) => { table.setPageIndex(page - 1); }}
          size="sm"
          siblings={1}
          boundaries={1}
          aria-label="Table pagination"
          getItemProps={(page) => ({ 'aria-label': `Page ${String(page)}` })}
          getControlProps={(control) => ({ 'aria-label': control })}
        />
      </Group>
    </Group>
  );
}
