# `<DataTable>`

Shared table composition for Rioku Admin list views. Built on `@tanstack/react-table` v8 (headless state) + Mantine 9 `<Table>` primitives (styling).

## Quick start

```tsx
import { DataTable } from '@/components/data-table';
import type { ColumnDef } from '@tanstack/react-table';
import { StatusCell, TimestampCell } from '@/components/data-table';

interface Service {
  id: string;
  name: string;
  status: string;
  createdAt: string;
}

const columns: ColumnDef<Service>[] = [
  { accessorKey: 'id', header: 'ID', enableSorting: false },
  { accessorKey: 'name', header: 'Name', enableSorting: true },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ getValue }) => <StatusCell status={getValue<string>()} />,
  },
  {
    accessorKey: 'createdAt',
    header: 'Created',
    cell: ({ getValue }) => <TimestampCell value={getValue<string>()} />,
  },
];

function ServicesPage() {
  const { data, isLoading, isError } = useServices();

  return (
    <DataTable
      data={data ?? []}
      columns={columns}
      pagination={{ pageSize: 25 }}
      sorting
      filtering="global"
      columnVisibility
      stickyHeader
      urlSyncKey="services"
      isLoading={isLoading}
      isError={isError}
      onRowClick={(row) => navigate({ to: '/services/$id', params: { id: row.id } })}
      caption="All gateway services"
    />
  );
}
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `data` | `TData[]` | required | Rows to display |
| `columns` | `ColumnDef<TData, TValue>[]` | required | TanStack Table column definitions |
| `pagination` | `boolean \| { pageSize: number }` | `false` | Enable client-side pagination |
| `sorting` | `boolean` | `true` | Enable column sorting |
| `filtering` | `'global' \| 'per-column' \| 'both' \| false` | `false` | Filter mode |
| `rowSelection` | `boolean \| 'single' \| 'multiple'` | `false` | Row selection mode |
| `columnVisibility` | `boolean` | `false` | Show column visibility toggle menu |
| `stickyHeader` | `boolean` | `false` | Stick header row to top of scroll container |
| `virtualized` | `boolean \| { threshold: number }` | — | Scaffold only in stage 1 — no effect |
| `isLoading` | `boolean` | `false` | Show loading state |
| `isError` | `boolean` | `false` | Show error state |
| `loadingState` | `ReactNode` | `<LoadingState shape="table" />` | Custom loading placeholder |
| `emptyState` | `ReactNode` | Generic empty message | Custom empty state |
| `errorState` | `ReactNode` | `<ErrorState />` | Custom error state |
| `urlSyncKey` | `string` | — | Namespace key for URL-synced pagination + sort |
| `onRowClick` | `(row: TData) => void` | — | Row click handler (enables keyboard nav) |
| `bulkActions` | `BulkAction[]` | `[]` | Actions shown in toolbar when rows are selected |
| `caption` | `string` | — | Screen-reader caption for the table |

## Column helpers

```tsx
import { StatusCell, TimestampCell, ActionsCell } from '@/components/data-table';
```

- **`<StatusCell status="active" />`** — Colored badge. Knows common statuses (active, inactive, pending, error, warning). Override with `colorMap`.
- **`<TimestampCell value={isoString} format="relative" />`** — Shows relative or absolute time; wraps in a tooltip.
- **`<ActionsCell actions={[{ label: 'Edit', onClick }]} />`** — Overflow button. Stage 1: single-action. Stage 2: upgrade to Mantine `<Menu>` dropdown.

## URL sync

When `urlSyncKey="services"` is set, pagination and sort state are encoded in URL search params:

```
?services_p=2&services_s=25&services_sort=name:asc
```

Uses `useSearch({ strict: false })` so it works from any route without declaring a search schema. The URL-sync effect fires on sort or pagination change.

Per-column filter URL-sync for PII fields is handled separately via `useOpaqueFilter` — wire it in the feature component, not inside DataTable.

## Deferred features

| Feature | Status | Notes |
|---------|--------|-------|
| Virtualization | Scaffold only | `@tanstack/react-virtual` not installed. Add when needed for >500-row views. |
| Column reorder | Deferred | Resize ships; reorder needs drag-over state management. |
| Per-column filter UI | Deferred | Column filter state wired in TanStack Table; no UI in stage 1. |
| Server-side pagination | Stage 2 | Currently client-side only. |
