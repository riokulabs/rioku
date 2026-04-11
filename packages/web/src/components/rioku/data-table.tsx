import { useState, useMemo, useCallback, useEffect } from 'react'
import {
  ArrowUpDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  SearchIcon,
  CheckIcon,
  MinusIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/rioku/empty-state'
import { FacetedFilter, type FilterColumn } from '@/components/rioku/faceted-filter'
import {
  TablePreferences,
  type Density,
} from '@/components/rioku/table-preferences'
import { useTableUrlState } from '@/hooks/use-table-url-state'

interface Column<T> {
  key: string
  header: string
  render?: (row: T) => React.ReactNode
  sortable?: boolean
  hideable?: boolean
  defaultVisible?: boolean
  minWidth?: string
}

interface DataTableProps<T> {
  columns: Column<T>[]
  data: T[]
  rowKey?: (row: T) => string
  searchable?: boolean
  searchPlaceholder?: string
  pageSize?: number
  emptyState?: React.ReactNode
  actions?: React.ReactNode
  title?: string
  linkColumn?: string
  onRowClick?: (row: T) => void
  selectable?: boolean
  onSelectionChange?: (ids: string[]) => void
  bulkActions?: (ids: string[]) => React.ReactNode
  rowActions?: (row: T) => React.ReactNode
  filterColumns?: FilterColumn[]
  preferencesKey?: string
  syncUrl?: boolean
  density?: Density
}

const densityPadding: Record<Density, string> = {
  compact: 'py-1',
  comfortable: 'py-2',
  spacious: 'py-3',
}

function loadPreferences(key: string): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(`rioku-table-${key}`)
    if (raw) return JSON.parse(raw)
  } catch {
    // ignore
  }
  return null
}

function savePreferences(key: string, prefs: Record<string, unknown>) {
  try {
    localStorage.setItem(`rioku-table-${key}`, JSON.stringify(prefs))
  } catch {
    // ignore
  }
}

function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  rowKey,
  searchable = false,
  searchPlaceholder = 'Search...',
  pageSize: initialPageSize,
  emptyState,
  actions,
  title,
  linkColumn,
  onRowClick,
  selectable = false,
  onSelectionChange,
  bulkActions,
  rowActions,
  filterColumns,
  preferencesKey,
  syncUrl = false,
  density: initialDensity = 'comfortable',
}: DataTableProps<T>) {
  // URL state (only active when syncUrl=true)
  const urlState = useTableUrlState({ enabled: syncUrl })

  // Column visibility
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>(() => {
    if (preferencesKey) {
      const saved = loadPreferences(preferencesKey)
      if (saved?.columnVisibility) {
        return saved.columnVisibility as Record<string, boolean>
      }
    }
    const initial: Record<string, boolean> = {}
    for (const col of columns) {
      initial[col.key] = col.defaultVisible !== false
    }
    return initial
  })

  // Density
  const [density, setDensity] = useState<Density>(() => {
    if (preferencesKey) {
      const saved = loadPreferences(preferencesKey)
      if (saved?.density && ['compact', 'comfortable', 'spacious'].includes(saved.density as string)) {
        return saved.density as Density
      }
    }
    return initialDensity
  })

  // Page size (configurable via preferences)
  const [pageSize, setPageSize] = useState<number | undefined>(() => {
    if (preferencesKey) {
      const saved = loadPreferences(preferencesKey)
      if (typeof saved?.pageSize === 'number') {
        return saved.pageSize
      }
    }
    return initialPageSize
  })

  // Local state (used when syncUrl is false)
  const [localSearch, setLocalSearch] = useState('')
  const [localSortKey, setLocalSortKey] = useState<string | null>(null)
  const [localSortDir, setLocalSortDir] = useState<'asc' | 'desc'>('asc')
  const [localPage, setLocalPage] = useState(0)
  const [localFilters, setLocalFilters] = useState<Record<string, string[]>>({})

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Unified accessors
  const search = syncUrl ? urlState.state.search : localSearch
  const sortKey = syncUrl ? urlState.state.sort : localSortKey
  const sortDir = syncUrl ? urlState.state.sortDir : localSortDir
  const page = syncUrl ? urlState.state.page : localPage
  const activeFilters = syncUrl ? urlState.state.filters : localFilters

  const setSearch = useCallback(
    (value: string) => {
      if (syncUrl) {
        urlState.setSearch(value)
      } else {
        setLocalSearch(value)
        setLocalPage(0)
      }
    },
    [syncUrl, urlState],
  )

  const handleSort = useCallback(
    (key: string) => {
      if (syncUrl) {
        if (sortKey === key) {
          urlState.setSort(key, sortDir === 'asc' ? 'desc' : 'asc')
        } else {
          urlState.setSort(key, 'asc')
        }
      } else {
        if (localSortKey === key) {
          setLocalSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
        } else {
          setLocalSortKey(key)
          setLocalSortDir('asc')
        }
        setLocalPage(0)
      }
    },
    [syncUrl, sortKey, sortDir, localSortKey, urlState],
  )

  const setPage = useCallback(
    (value: number | ((prev: number) => number)) => {
      if (syncUrl) {
        const nextPage = typeof value === 'function' ? value(urlState.state.page) : value
        urlState.setPage(nextPage)
      } else {
        setLocalPage(value)
      }
    },
    [syncUrl, urlState],
  )

  const setFilter = useCallback(
    (key: string, values: string[]) => {
      if (syncUrl) {
        urlState.setFilter(key, values)
      } else {
        setLocalFilters((prev) => ({ ...prev, [key]: values }))
        setLocalPage(0)
      }
    },
    [syncUrl, urlState],
  )

  // Persist preferences
  useEffect(() => {
    if (preferencesKey) {
      savePreferences(preferencesKey, {
        columnVisibility,
        density,
        pageSize,
      })
    }
  }, [preferencesKey, columnVisibility, density, pageSize])

  // Visible columns
  const visibleColumns = useMemo(
    () => columns.filter((col) => columnVisibility[col.key] !== false),
    [columns, columnVisibility],
  )

  // Row key helper
  const getRowKey = useCallback(
    (row: T, index: number): string => {
      if (rowKey) return rowKey(row)
      if ('id' in row && row.id != null) return String(row.id)
      return String(index)
    },
    [rowKey],
  )

  // Filtering (search + faceted)
  const filtered = useMemo(() => {
    let result = data

    // Text search
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter((row) =>
        columns.some((col) => {
          const val = row[col.key]
          return val != null && String(val).toLowerCase().includes(q)
        }),
      )
    }

    // Faceted filters
    for (const [key, values] of Object.entries(activeFilters)) {
      if (values.length > 0) {
        result = result.filter((row) => {
          const val = row[key]
          return val != null && values.includes(String(val))
        })
      }
    }

    return result
  }, [data, search, columns, activeFilters])

  // Sorting
  const sorted = useMemo(() => {
    if (!sortKey) return filtered
    return [...filtered].sort((a, b) => {
      const aVal = a[sortKey]
      const bVal = b[sortKey]
      if (aVal == null && bVal == null) return 0
      if (aVal == null) return 1
      if (bVal == null) return -1
      const cmp = String(aVal).localeCompare(String(bVal), undefined, {
        numeric: true,
      })
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [filtered, sortKey, sortDir])

  // Pagination
  const totalPages = pageSize ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1
  const paged = pageSize
    ? sorted.slice(page * pageSize, (page + 1) * pageSize)
    : sorted

  // Selection helpers
  const allPageIds = useMemo(
    () => paged.map((row, i) => getRowKey(row, page * (pageSize ?? 0) + i)),
    [paged, getRowKey, page, pageSize],
  )

  const allSelected = allPageIds.length > 0 && allPageIds.every((id) => selectedIds.has(id))
  const someSelected = allPageIds.some((id) => selectedIds.has(id))

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allSelected) {
        for (const id of allPageIds) next.delete(id)
      } else {
        for (const id of allPageIds) next.add(id)
      }
      return next
    })
  }, [allSelected, allPageIds])

  const toggleRow = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  // Notify parent of selection changes
  useEffect(() => {
    if (onSelectionChange) {
      onSelectionChange(Array.from(selectedIds))
    }
  }, [selectedIds, onSelectionChange])

  // Column toggle handler for preferences
  const handleColumnToggle = useCallback(
    (key: string, visible: boolean) => {
      setColumnVisibility((prev) => ({ ...prev, [key]: visible }))
    },
    [],
  )

  // Preferences column data
  const preferencesColumns = useMemo(
    () =>
      columns.map((col) => ({
        key: col.key,
        header: col.header,
        visible: columnVisibility[col.key] !== false,
        hideable: col.hideable !== false,
      })),
    [columns, columnVisibility],
  )

  // Total columns (including checkbox + actions)
  const totalColSpan = visibleColumns.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0)

  const hasActiveFilters = Object.values(activeFilters).some((v) => v.length > 0)

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      {(title || searchable || actions || filterColumns || preferencesKey) && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            {title && (
              <h3 className="text-sm font-medium">{title}</h3>
            )}
            {searchable && (
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder={searchPlaceholder}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 w-48 pl-8 sm:w-64"
                />
              </div>
            )}
            {filterColumns && filterColumns.map((fc) => (
              <FacetedFilter
                key={fc.key}
                column={fc}
                selected={activeFilters[fc.key] ?? []}
                onChange={(values) => setFilter(fc.key, values)}
              />
            ))}
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  if (syncUrl) {
                    urlState.clearFilters()
                  } else {
                    setLocalFilters({})
                    setLocalPage(0)
                  }
                }}
              >
                Clear filters
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {preferencesKey && (
              <TablePreferences
                columns={preferencesColumns}
                onColumnToggle={handleColumnToggle}
                density={density}
                onDensityChange={setDensity}
                pageSize={pageSize ?? 25}
                onPageSizeChange={setPageSize}
              />
            )}
            {actions}
          </div>
        </div>
      )}

      {/* Bulk action bar */}
      {selectable && selectedIds.size > 0 && bulkActions && (
        <div
          data-testid="bulk-action-bar"
          className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm"
        >
          <span className="font-medium">
            {selectedIds.size} selected
          </span>
          <div className="flex items-center gap-2">
            {bulkActions(Array.from(selectedIds))}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              {selectable && (
                <TableHead className="w-10">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={allSelected ? true : someSelected ? 'mixed' : false}
                    aria-label="Select all rows"
                    className={cn(
                      'flex size-4 items-center justify-center rounded-sm border transition-colors',
                      'focus-visible:ring-2 focus-visible:ring-ring',
                      allSelected
                        ? 'border-primary bg-primary text-primary-foreground'
                        : someSelected
                          ? 'border-primary bg-primary/50 text-primary-foreground'
                          : 'border-muted-foreground/30',
                    )}
                    onClick={toggleSelectAll}
                  >
                    {allSelected && <CheckIcon className="size-3" />}
                    {someSelected && !allSelected && <MinusIcon className="size-3" />}
                  </button>
                </TableHead>
              )}
              {visibleColumns.map((col) => (
                <TableHead
                  key={col.key}
                  style={col.minWidth ? { minWidth: col.minWidth } : undefined}
                >
                  {col.sortable ? (
                    <button
                      type="button"
                      className={cn(
                        'inline-flex items-center gap-1 hover:text-foreground',
                        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded',
                        sortKey === col.key && 'text-foreground',
                      )}
                      onClick={() => handleSort(col.key)}
                    >
                      {col.header}
                      <ArrowUpDownIcon className="size-3" />
                    </button>
                  ) : (
                    col.header
                  )}
                </TableHead>
              ))}
              {rowActions && (
                <TableHead className="w-10">
                  <span className="sr-only">Actions</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.length > 0 ? (
              paged.map((row, i) => {
                const id = getRowKey(row, page * (pageSize ?? 0) + i)
                const isSelected = selectedIds.has(id)

                return (
                  <TableRow
                    key={id}
                    data-state={isSelected ? 'selected' : undefined}
                    className={cn(
                      'group',
                      (linkColumn || onRowClick) && 'cursor-pointer',
                    )}
                  >
                    {selectable && (
                      <TableCell className={densityPadding[density]}>
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={isSelected}
                          aria-label={`Select row ${id}`}
                          className={cn(
                            'flex size-4 items-center justify-center rounded-sm border transition-colors',
                            'focus-visible:ring-2 focus-visible:ring-ring',
                            isSelected
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-muted-foreground/30',
                          )}
                          onClick={() => toggleRow(id)}
                        >
                          {isSelected && <CheckIcon className="size-3" />}
                        </button>
                      </TableCell>
                    )}
                    {visibleColumns.map((col) => {
                      const isLink = col.key === linkColumn
                      const cellContent = col.render
                        ? col.render(row)
                        : (row[col.key] as React.ReactNode) ?? '\u2014'

                      return (
                        <TableCell
                          key={col.key}
                          className={densityPadding[density]}
                        >
                          {isLink ? (
                            <button
                              type="button"
                              className="text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded"
                              onClick={() => onRowClick?.(row)}
                              data-testid="link-cell"
                            >
                              {cellContent}
                            </button>
                          ) : (
                            cellContent
                          )}
                        </TableCell>
                      )
                    })}
                    {rowActions && (
                      <TableCell className={cn(densityPadding[density], 'text-right')}>
                        <div className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                          {rowActions(row)}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                )
              })
            ) : (
              <TableRow>
                <TableCell colSpan={totalColSpan} className="h-48">
                  {emptyState ?? (
                    <EmptyState
                      title="No results"
                      description={
                        search
                          ? 'Try adjusting your search query.'
                          : 'No data to display.'
                      }
                    />
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {pageSize && sorted.length > pageSize && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {page * pageSize + 1}&ndash;
            {Math.min((page + 1) * pageSize, sorted.length)} of{' '}
            {sorted.length}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeftIcon className="size-4" />
              <span className="sr-only">Previous page</span>
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRightIcon className="size-4" />
              <span className="sr-only">Next page</span>
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export { DataTable }
export type { DataTableProps, Column }
