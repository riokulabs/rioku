import { useState, useCallback } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Download, FileJson, FileSpreadsheet } from 'lucide-react'

import { PageHeader } from '@/components/rioku/page-header'
import { DataTable } from '@/components/rioku/data-table'
import { EmptyState } from '@/components/rioku/empty-state'
import { TimeAgo } from '@/components/rioku/time-ago'
import { CodeBlock } from '@/components/rioku/code-block'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { apiClient, type AuditEntry } from '@/lib/api'
import { exportToCsv, exportToJson } from '@/lib/export-utils'

export const Route = createFileRoute('/audit')({
  loader: ({ context }) =>
    context.queryClient
      .ensureQueryData({
        queryKey: ['audit', { range: '24h' }],
        queryFn: () => apiClient.get<AuditEntry[]>('/audit', { range: '24h' }),
      })
      .catch(() => [] as AuditEntry[]),
  component: Audit,
})

const ENTITY_TYPES = [
  'route',
  'service',
  'policy',
  'api_key',
  'config',
  'auth',
  'settings',
  'plugin',
] as const

const OPERATIONS = [
  'create',
  'update',
  'delete',
  'enable',
  'disable',
  'login',
  'refresh',
] as const

const ACTION_TYPE_GROUPS: Record<string, string[]> = {
  'Configuration changes': ['create', 'update', 'delete'],
  'Access events': ['login', 'refresh'],
  'Status changes': ['enable', 'disable'],
}

const QUICK_RANGES: Array<{ label: string; hours: number }> = [
  { label: '1h', hours: 1 },
  { label: '6h', hours: 6 },
  { label: '24h', hours: 24 },
  { label: '7d', hours: 168 },
  { label: '30d', hours: 720 },
]

function operationColor(op: string): string {
  switch (op) {
    case 'create':
      return 'bg-green-500/10 text-green-700 dark:text-green-400 border-transparent'
    case 'update':
      return 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-transparent'
    case 'delete':
      return 'bg-red-500/10 text-red-700 dark:text-red-400 border-transparent'
    case 'enable':
      return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-transparent'
    case 'disable':
      return 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-transparent'
    case 'login':
      return 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-transparent'
    case 'refresh':
      return 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border-transparent'
    default:
      return ''
  }
}

function toLocalDatetimeValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function Audit() {
  const { t } = useTranslation('audit')

  // Filters
  const [actorFilter, setActorFilter] = useState('')
  const [entityTypeFilter, setEntityTypeFilter] = useState<string>('')
  const [operationFilter, setOperationFilter] = useState<string>('')
  const [actionTypeFilter, setActionTypeFilter] = useState<string>('')

  // Date range
  const [endDate, setEndDate] = useState(() => new Date())
  const [startDate, setStartDate] = useState(
    () => new Date(Date.now() - 24 * 60 * 60 * 1000),
  )

  // Detail sheet
  const [selectedEntry, setSelectedEntry] = useState<AuditEntry | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  const since = startDate.toISOString()
  const until = endDate.toISOString()

  const filters: Record<string, string> = { since, until }
  if (actorFilter) filters.actor = actorFilter
  if (entityTypeFilter) filters.entity_type = entityTypeFilter
  if (operationFilter) filters.operation = operationFilter

  const { data, isLoading } = useQuery<AuditEntry[]>({
    queryKey: ['audit', filters],
    queryFn: () => apiClient.get<AuditEntry[]>('/audit', filters),
  })

  // Apply action type filter client-side (groups multiple operations)
  const entries = (data ?? []).filter((entry) => {
    if (!actionTypeFilter) return true
    const ops = ACTION_TYPE_GROUPS[actionTypeFilter]
    return ops ? ops.includes(entry.operation) : true
  })

  const handleRowClick = useCallback((entry: AuditEntry) => {
    setSelectedEntry(entry)
    setSheetOpen(true)
  }, [])

  const handleQuickRange = useCallback((hours: number) => {
    const now = new Date()
    setEndDate(now)
    setStartDate(new Date(now.getTime() - hours * 60 * 60 * 1000))
  }, [])

  const handleExport = useCallback(
    (format: 'csv' | 'json') => {
      if (!entries.length) return

      if (format === 'csv') {
        exportToCsv(
          entries as unknown as Record<string, unknown>[],
          ['occurredAt', 'actor', 'entityType', 'entityId', 'operation', 'configVersion'],
          'audit-log.csv',
        )
      } else {
        exportToJson(entries, 'audit-log.json')
      }
    },
    [entries],
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="outline" size="sm">
                  <Download className="size-3.5" data-icon="inline-start" />
                  {t('actions.exportLog')}
                </Button>
              }
            />
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => handleExport('csv')}>
                <FileSpreadsheet className="size-3.5" />
                {t('actions.exportCsv')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport('json')}>
                <FileJson className="size-3.5" />
                {t('actions.exportJson')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      {/* Date range and quick ranges */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Input
            type="datetime-local"
            value={toLocalDatetimeValue(startDate)}
            onChange={(e) => e.target.value && setStartDate(new Date(e.target.value))}
            className="h-7 w-48"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            type="datetime-local"
            value={toLocalDatetimeValue(endDate)}
            onChange={(e) => e.target.value && setEndDate(new Date(e.target.value))}
            className="h-7 w-48"
          />
        </div>
        <div className="flex items-center gap-1">
          {QUICK_RANGES.map((r) => (
            <Button
              key={r.label}
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => handleQuickRange(r.hours)}
            >
              {r.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder={t('filters.filterActor')}
          value={actorFilter}
          onChange={(e) => setActorFilter(e.target.value)}
          className="h-7 w-48"
        />

        <Select value={entityTypeFilter} onValueChange={(v) => setEntityTypeFilter(v ?? '')}>
          <SelectTrigger size="sm" className="w-36">
            <SelectValue placeholder={t('filters.filterEntityType')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">{t('filters.filterEntityType')}</SelectItem>
            {ENTITY_TYPES.map((et) => (
              <SelectItem key={et} value={et}>
                {t(`entityTypes.${et}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={operationFilter} onValueChange={(v) => setOperationFilter(v ?? '')}>
          <SelectTrigger size="sm" className="w-36">
            <SelectValue placeholder={t('filters.filterOperation')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">{t('filters.filterOperation')}</SelectItem>
            {OPERATIONS.map((op) => (
              <SelectItem key={op} value={op}>
                {t(`operations.${op}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={actionTypeFilter} onValueChange={(v) => setActionTypeFilter(v ?? '')}>
          <SelectTrigger size="sm" className="w-48">
            <SelectValue placeholder="Action type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All action types</SelectItem>
            {Object.keys(ACTION_TYPE_GROUPS).map((group) => (
              <SelectItem key={group} value={group}>
                {group}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Audit entries table */}
      {isLoading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : (
        <DataTable
          columns={[
            {
              key: 'occurredAt',
              header: t('columns.timestamp'),
              render: (row) => <TimeAgo date={row.occurredAt as string} />,
            },
            {
              key: 'actor',
              header: t('columns.actor'),
            },
            {
              key: 'entityType',
              header: t('columns.entityType'),
              render: (row) => (
                <Badge variant="secondary">
                  {t(`entityTypes.${row.entityType as string}`)}
                </Badge>
              ),
            },
            {
              key: 'entityId',
              header: t('columns.entityId'),
              render: (row) => (
                <span className="font-mono text-xs">
                  {row.entityId as string}
                </span>
              ),
            },
            {
              key: 'operation',
              header: t('columns.operation'),
              render: (row) => (
                <Badge
                  variant="outline"
                  className={operationColor(row.operation as string)}
                >
                  {t(`operations.${row.operation as string}`)}
                </Badge>
              ),
            },
            {
              key: 'configVersion',
              header: t('columns.configVersion'),
              render: (row) => (
                <span className="font-mono text-xs text-muted-foreground">
                  {String(row.configVersion ?? '')}
                </span>
              ),
            },
          ]}
          data={entries as unknown as Record<string, unknown>[]}
          searchable
          searchPlaceholder={t('filters.filterActor')}
          pageSize={20}
          emptyState={
            <EmptyState
              title={t('empty.noAuditEntries')}
              description={t('empty.noAuditEntriesDesc')}
            />
          }
        />
      )}

      {/* Detail sheet with before/after diff */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{t('actions.viewDiff')}</SheetTitle>
            {selectedEntry && (
              <SheetDescription>
                {selectedEntry.operation} {selectedEntry.entityType}{' '}
                {selectedEntry.entityId}
              </SheetDescription>
            )}
          </SheetHeader>
          {selectedEntry && (
            <div className="space-y-4 overflow-auto px-4 pb-4">
              <div className="grid grid-cols-2 gap-y-2 text-sm">
                <span className="text-muted-foreground">
                  {t('columns.actor')}
                </span>
                <span>{selectedEntry.actor}</span>

                <span className="text-muted-foreground">
                  {t('columns.operation')}
                </span>
                <Badge
                  variant="outline"
                  className={`w-fit ${operationColor(selectedEntry.operation)}`}
                >
                  {t(`operations.${selectedEntry.operation}`)}
                </Badge>

                <span className="text-muted-foreground">
                  {t('columns.entityType')}
                </span>
                <Badge variant="secondary" className="w-fit">
                  {t(`entityTypes.${selectedEntry.entityType}`)}
                </Badge>

                <span className="text-muted-foreground">
                  {t('columns.entityId')}
                </span>
                <span className="font-mono text-xs">
                  {selectedEntry.entityId}
                </span>

                <span className="text-muted-foreground">
                  {t('columns.timestamp')}
                </span>
                <TimeAgo date={selectedEntry.occurredAt} />
              </div>

              {/* Before/After diff */}
              {selectedEntry.beforeValues && selectedEntry.afterValues && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium">Changes</h4>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <span className="text-xs font-medium text-red-600 dark:text-red-400">Before</span>
                      <div className="rounded-md border border-red-500/20 bg-red-500/5 p-2">
                        <CodeBlock value={selectedEntry.beforeValues} maxHeight="200px" />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <span className="text-xs font-medium text-green-600 dark:text-green-400">After</span>
                      <div className="rounded-md border border-green-500/20 bg-green-500/5 p-2">
                        <CodeBlock value={selectedEntry.afterValues} maxHeight="200px" />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Create — only afterValues */}
              {!selectedEntry.beforeValues && selectedEntry.afterValues && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium">Created with:</h4>
                  <CodeBlock value={selectedEntry.afterValues} maxHeight="320px" />
                </div>
              )}

              {/* Delete — only beforeValues */}
              {selectedEntry.beforeValues && !selectedEntry.afterValues && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium">Deleted:</h4>
                  <CodeBlock value={selectedEntry.beforeValues} maxHeight="320px" />
                </div>
              )}

              {/* Legacy diff fallback */}
              {selectedEntry.diff && !selectedEntry.beforeValues && !selectedEntry.afterValues && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium">{t('actions.viewDiff')}</h4>
                  <CodeBlock
                    value={selectedEntry.diff}
                    language="json"
                    maxHeight="320px"
                  />
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
