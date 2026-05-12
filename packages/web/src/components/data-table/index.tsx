/**
 * <DataTable> — shared table composition for Rioku Admin.
 *
 * Built on:
 *   - @tanstack/react-table v8  (headless state: sort, filter, pagination, selection, resize)
 *   - Mantine 9 <Table> primitives (header/body/row/cell styling)
 *
 * Virtualization: @tanstack/react-virtual is NOT installed. Virtualization is
 * scaffold-only. Datasets at admin audit scale (≤1 000 rows per page) render
 * fine without windowing. Real virtualization can be added if needed.
 *
 * Column reorder: deferred. Column resize works via drag-handle on header
 * right-edge (inline width styles on <col> elements).
 *
 * URL-sync: if `urlSyncKey` is set, pagination + sort are encoded in search params
 * via useSearch({ strict: false }) + useNavigate(). Per-column filter URL-sync
 * for PII fields uses useFilterUrlHandle (imported by the caller, not wired
 * internally — filter state stays in React state unless the caller manages it).
 */

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type RowSelectionState,
  type ColumnFiltersState,
  type ColumnSizingState,
  type VisibilityState,
} from '@tanstack/react-table';
import { Table, ScrollArea, Box, Stack, Checkbox } from '@mantine/core';
import { useSearch, useNavigate } from '@tanstack/react-router';
import { IconArrowUp, IconArrowDown, IconArrowsSort, IconSelector } from '@tabler/icons-react';

import { ErrorState } from '@/components/error-state';
import { EmptyState } from '@/components/empty-state';
import { LoadingState } from '@/components/loading-state';
import { DataTableToolbar, type BulkAction } from './toolbar';
import { DataTablePagination } from './pagination';
import { decodeUrlState, encodeUrlState } from './url-sync';

// ── Re-exports ────────────────────────────────────────────────────────────────
export { StatusCell, TimestampCell, ActionsCell } from './column-helpers';
export type {
  StatusCellProps,
  TimestampCellProps,
  ActionsCellProps,
  ActionItem,
} from './column-helpers';
export {
  DataTableToolbar,
  GlobalSearchInput,
  ColumnVisibilityMenu,
  BulkActionsBar,
} from './toolbar';
export type { BulkAction, DataTableToolbarProps, BulkActionsBarProps } from './toolbar';
export { DataTablePagination } from './pagination';
export type { DataTablePaginationProps } from './pagination';

// ── Public API ────────────────────────────────────────────────────────────────

export interface DataTableProps<TData, TValue = unknown> {
  data: TData[];
  columns: ColumnDef<TData, TValue>[];

  // Features
  pagination?: boolean | { pageSize: number };
  sorting?: boolean;
  filtering?: 'global' | 'per-column' | 'both' | false;
  rowSelection?: boolean | 'single' | 'multiple';
  columnVisibility?: boolean;
  stickyHeader?: boolean;
  /**
   * Virtualization is scaffold-only in stage 1. The prop is accepted for API
   * compatibility but has no effect — all rows render. Actual windowing will
   * be implemented when @tanstack/react-virtual is added.
   */
  virtualized?: boolean | { threshold: number };

  // State slots
  loadingState?: ReactNode;
  emptyState?: ReactNode;
  errorState?: ReactNode;
  isLoading?: boolean;
  isError?: boolean;

  // URL-sync
  urlSyncKey?: string;

  // Events
  onRowClick?: (row: TData) => void;

  // Bulk actions (rendered in toolbar when rows are selected)
  bulkActions?: BulkAction[];

  // Accessibility
  caption?: string;
}

// ── Resize handle size (px) ───────────────────────────────────────────────────
const RESIZE_HANDLE_WIDTH = 4;

// ── Default page size ─────────────────────────────────────────────────────────
const DEFAULT_PAGE_SIZE = 25;

// ── Sort icon helper ──────────────────────────────────────────────────────────
function SortIcon({ direction }: { direction: false | 'asc' | 'desc' }) {
  if (direction === 'asc') return <IconArrowUp size={14} aria-hidden />;
  if (direction === 'desc') return <IconArrowDown size={14} aria-hidden />;
  return <IconArrowsSort size={14} aria-hidden style={{ opacity: 0.4 }} />;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DataTable<TData, TValue = unknown>({
  data,
  columns: columnDefs,
  pagination = false,
  sorting = true,
  filtering = false,
  rowSelection = false,
  columnVisibility: showColumnVisibility = false,
  stickyHeader = false,
  virtualized: _virtualized,
  loadingState,
  emptyState,
  errorState,
  isLoading = false,
  isError = false,
  urlSyncKey,
  onRowClick,
  bulkActions = [],
  caption,
}: DataTableProps<TData, TValue>) {
  // ── URL sync bootstrap ─────────────────────────────────────────────────────

  // Read raw search params without schema coupling (strict: false).
  // useSearch({ strict: false }) returns the raw search object without a schema;
  // the returned type is a superset of Record<string, unknown> — we narrow it.
  const search: Record<string, unknown> = useSearch({ strict: false });
  const navigate = useNavigate();

  const defaultPageSize =
    pagination && typeof pagination === 'object' ? pagination.pageSize : DEFAULT_PAGE_SIZE;

  const initialUrlState = useMemo(
    () => (urlSyncKey ? decodeUrlState(urlSyncKey, search, { pageSize: defaultPageSize }) : null),
    // Only run once on mount — intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // ── Table state ────────────────────────────────────────────────────────────

  const [sortingState, setSortingState] = useState<SortingState>(() => {
    if (initialUrlState?.sort) {
      return [{ id: initialUrlState.sort.id, desc: initialUrlState.sort.desc }];
    }
    return [];
  });

  const [globalFilter, setGlobalFilter] = useState('');
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [selectionState, setSelectionState] = useState<RowSelectionState>({});
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [visibilityState, setVisibilityState] = useState<VisibilityState>({});

  const paginationState = useMemo(
    () => ({
      pageIndex: initialUrlState ? initialUrlState.page - 1 : 0,
      pageSize: initialUrlState?.pageSize ?? defaultPageSize,
    }),
    // Intentional: stable initial value only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [paginationInternal, setPaginationInternal] = useState(paginationState);

  // ── Column defs with optional selection column ─────────────────────────────

  const selectionEnabled = rowSelection !== false;
  const multiSelect = rowSelection === true || rowSelection === 'multiple';

  const finalColumns = useMemo<ColumnDef<TData, TValue>[]>(() => {
    if (!selectionEnabled) return columnDefs;
    const selCol: ColumnDef<TData, TValue> = {
      id: '__select__',
      size: 40,
      enableSorting: false,
      enableResizing: false,
      enableHiding: false,
      header: ({ table }) =>
        multiSelect ? (
          <Checkbox
            size="xs"
            checked={table.getIsAllPageRowsSelected()}
            indeterminate={table.getIsSomePageRowsSelected()}
            onChange={table.getToggleAllPageRowsSelectedHandler()}
            aria-label="Select all rows on this page"
          />
        ) : null,
      cell: ({ row }) => (
        <Checkbox
          size="xs"
          checked={row.getIsSelected()}
          disabled={!row.getCanSelect()}
          onChange={row.getToggleSelectedHandler()}
          aria-label={`Select row ${String(row.index + 1)}`}
          onClick={(e) => {
            e.stopPropagation();
          }}
        />
      ),
    } as ColumnDef<TData, TValue>;
    return [selCol, ...columnDefs];
  }, [columnDefs, selectionEnabled, multiSelect]);

  // ── Row models — conditional to avoid unused tree-shaking hints ────────────

  const enablePagination = pagination !== false;
  const enableSorting = sorting;
  const enableGlobalFilter = filtering === 'global' || filtering === 'both';
  const enableColumnFilter = filtering === 'per-column' || filtering === 'both';

  const table = useReactTable<TData>({
    data,
    columns: finalColumns,
    state: {
      sorting: sortingState,
      globalFilter,
      columnFilters,
      rowSelection: selectionState,
      columnSizing,
      columnVisibility: visibilityState,
      ...(enablePagination ? { pagination: paginationInternal } : {}),
    },
    enableSorting,
    enableGlobalFilter,
    enableColumnFilters: enableColumnFilter,
    enableRowSelection: selectionEnabled
      ? multiSelect
        ? true
        : (row) => !row.getIsSelected() || selectionState[row.id] === true
      : false,
    enableMultiRowSelection: multiSelect,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    onSortingChange: setSortingState,
    onGlobalFilterChange: setGlobalFilter,
    onColumnFiltersChange: setColumnFilters,
    onRowSelectionChange: setSelectionState,
    onColumnSizingChange: setColumnSizing,
    onColumnVisibilityChange: setVisibilityState,
    ...(enablePagination ? { onPaginationChange: setPaginationInternal } : {}),
    getCoreRowModel: getCoreRowModel(),
    ...(enableSorting ? { getSortedRowModel: getSortedRowModel() } : {}),
    ...(enableGlobalFilter || enableColumnFilter
      ? { getFilteredRowModel: getFilteredRowModel() }
      : {}),
    ...(enablePagination ? { getPaginationRowModel: getPaginationRowModel() } : {}),
  });

  // ── URL sync — write back on state change ──────────────────────────────────

  const urlSyncRef = useRef(urlSyncKey);
  urlSyncRef.current = urlSyncKey;

  useEffect(() => {
    const key = urlSyncRef.current;
    if (!key) return;

    const { pageIndex, pageSize } = paginationInternal;
    const sort = sortingState[0] ?? null;

    const params = encodeUrlState(key, {
      page: pageIndex + 1,
      pageSize,
      sort: sort ? { id: sort.id, desc: sort.desc } : null,
    });

    void navigate({
      search: (prev: Record<string, unknown>) => ({ ...prev, ...params }),
      replace: true,
    } as Parameters<typeof navigate>[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paginationInternal, sortingState]);

  // ── Derived selection state for toolbar ────────────────────────────────────

  const selectedRows = table.getSelectedRowModel().rows;
  const selectedRowIds = selectedRows.map((r) => r.id);
  const selectedCount = selectedRows.length;

  const clearSelection = useCallback(() => {
    setSelectionState({});
  }, []);

  // ── Roving tabindex for keyboard navigation ────────────────────────────────

  const [focusedRowIndex, setFocusedRowIndex] = useState<number>(-1);
  const tbodyRef = useRef<HTMLTableSectionElement>(null);

  function handleRowKeyDown(
    e: React.KeyboardEvent<HTMLTableRowElement>,
    rowIndex: number,
    rowData: TData,
  ) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = rowIndex + 1;
      const rows = tbodyRef.current?.querySelectorAll('tr[role="row"]');
      if (rows && next < rows.length) {
        (rows[next] as HTMLElement).focus();
        setFocusedRowIndex(next);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = rowIndex - 1;
      if (prev >= 0) {
        const rows = tbodyRef.current?.querySelectorAll('tr[role="row"]');
        if (rows) {
          (rows[prev] as HTMLElement).focus();
          setFocusedRowIndex(prev);
        }
      }
    } else if (e.key === 'Enter' && onRowClick) {
      e.preventDefault();
      onRowClick(rowData);
    }
  }

  // ── Render precedence: error > loading > empty > table ────────────────────

  if (isError) {
    return errorState ?? <ErrorState />;
  }

  if (isLoading) {
    return loadingState ?? <LoadingState shape="table" />;
  }

  const rows = table.getRowModel().rows;

  if (data.length === 0) {
    return (
      emptyState ?? (
        <EmptyState
          icon={IconSelector}
          title="No results"
          description="There is nothing here yet."
        />
      )
    );
  }

  // ── Table render ───────────────────────────────────────────────────────────

  const headerGroups = table.getHeaderGroups();

  return (
    <Stack gap={0}>
      {/* Toolbar */}
      <DataTableToolbar
        table={table}
        showGlobalFilter={enableGlobalFilter}
        globalFilter={globalFilter}
        onGlobalFilterChange={setGlobalFilter}
        showColumnVisibility={showColumnVisibility}
        selectedCount={selectedCount}
        selectedRowIds={selectedRowIds}
        bulkActions={bulkActions}
        onClearSelection={clearSelection}
      />

      {/* Table scroll container */}
      <ScrollArea type="auto">
        <Box style={{ overflowX: 'auto' }}>
          {/* col widths for resize */}
          <Table
            stickyHeader={stickyHeader}
            striped="odd"
            highlightOnHover={!!onRowClick}
            withTableBorder
            withColumnBorders
            style={{
              tableLayout: 'fixed',
              width: '100%',
            }}
          >
            {caption && (
              <caption
                style={{
                  captionSide: 'top',
                  textAlign: 'left',
                  padding: '0.5rem',
                  fontSize: '0.875rem',
                }}
              >
                {caption}
              </caption>
            )}

            {/* colgroup for resize widths */}
            <colgroup>
              {table.getVisibleLeafColumns().map((col) => {
                const size = col.getSize();
                return (
                  <col
                    key={col.id}
                    style={{
                      width: size ? `${String(size)}px` : undefined,
                      minWidth: size ? `${String(size)}px` : undefined,
                    }}
                  />
                );
              })}
            </colgroup>

            <Table.Thead>
              {headerGroups.map((headerGroup) => (
                <Table.Tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    const canSort = header.column.getCanSort();
                    const sortDir = header.column.getIsSorted();
                    const canResize = header.column.getCanResize();

                    return (
                      <Table.Th
                        key={header.id}
                        colSpan={header.colSpan}
                        aria-sort={
                          sortDir === 'asc'
                            ? 'ascending'
                            : sortDir === 'desc'
                              ? 'descending'
                              : undefined
                        }
                        style={{
                          position: 'relative',
                          padding: 0,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {header.isPlaceholder ? null : canSort ? (
                          <button
                            type="button"
                            onClick={header.column.getToggleSortingHandler()}
                            style={{
                              all: 'unset',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.25rem',
                              width: '100%',
                              padding: '0.5rem 0.75rem',
                              cursor: 'pointer',
                              userSelect: 'none',
                            }}
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            <SortIcon direction={sortDir} />
                          </button>
                        ) : (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.25rem',
                              padding: '0.5rem 0.75rem',
                            }}
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                          </span>
                        )}

                        {/* Resize handle — pointer-only interaction, no keyboard needed for resize. */}
                        {canResize && (
                          // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
                          <span
                            role="separator"
                            aria-label={`Resize ${typeof header.column.columnDef.header === 'string' ? header.column.columnDef.header : ''} column`}
                            aria-orientation="vertical"
                            onMouseDown={header.getResizeHandler()}
                            onTouchStart={header.getResizeHandler()}
                            style={{
                              position: 'absolute',
                              right: 0,
                              top: 0,
                              height: '100%',
                              width: `${String(RESIZE_HANDLE_WIDTH)}px`,
                              cursor: 'col-resize',
                              userSelect: 'none',
                              touchAction: 'none',
                              background: header.column.getIsResizing()
                                ? 'var(--mantine-color-blue-5)'
                                : 'transparent',
                              zIndex: 1,
                              display: 'block',
                            }}
                          />
                        )}
                      </Table.Th>
                    );
                  })}
                </Table.Tr>
              ))}
            </Table.Thead>

            <Table.Tbody ref={tbodyRef}>
              {rows.map((row, rowIndex) => {
                const isClickable = !!onRowClick;
                const isFocused = focusedRowIndex === rowIndex;

                return (
                  <Table.Tr
                    key={row.id}
                    role="row"
                    aria-selected={row.getIsSelected() ? true : undefined}
                    data-selected={row.getIsSelected() ? true : undefined}
                    tabIndex={isClickable ? (rowIndex === 0 || isFocused ? 0 : -1) : undefined}
                    style={{
                      cursor: isClickable ? 'pointer' : undefined,
                    }}
                    onClick={
                      isClickable
                        ? () => {
                            onRowClick(row.original);
                          }
                        : undefined
                    }
                    onKeyDown={
                      isClickable
                        ? (e) => {
                            handleRowKeyDown(e, rowIndex, row.original);
                          }
                        : undefined
                    }
                    onFocus={() => {
                      setFocusedRowIndex(rowIndex);
                    }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <Table.Td
                        key={cell.id}
                        role="cell"
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </Table.Td>
                    ))}
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Box>
      </ScrollArea>

      {/* Pagination */}
      {enablePagination && <DataTablePagination table={table} totalRows={data.length} />}
    </Stack>
  );
}
