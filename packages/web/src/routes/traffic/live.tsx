import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import {
  Activity,
  Timer,
  AlertTriangle,
  Users,
  Pause,
  Play,
} from 'lucide-react'
import { format } from 'date-fns'

import { PageHeader } from '@/components/rioku/page-header'
import { StatCard } from '@/components/rioku/stat-card'
import { Slot } from '@/components/plugin/slot'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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
import { ScrollArea } from '@/components/ui/scroll-area'
import { CodeBlock } from '@/components/rioku/code-block'
import { useSse } from '@/hooks/use-sse'

export const Route = createFileRoute('/traffic/live')({
  loader: () => {
    // SSE-driven page — no initial data to prefetch
  },
  component: TrafficLive,
})

interface RequestEvent {
  id: string
  timestamp: string
  method: string
  path: string
  status: number
  latency_ms: number
  upstream: string
  route_id: string
  headers?: Record<string, string>
}

const MAX_BUFFER = 200

function statusColorClass(status: number): string {
  if (status < 300) return 'bg-green-500/10 text-green-700 dark:text-green-400'
  if (status < 400) return 'bg-blue-500/10 text-blue-700 dark:text-blue-400'
  if (status < 500)
    return 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400'
  return 'bg-red-500/10 text-red-700 dark:text-red-400'
}

function TrafficLive() {
  const { t } = useTranslation('traffic')
  const [paused, setPaused] = useState(false)
  const [buffer, setBuffer] = useState<RequestEvent[]>([])
  const [selectedRequest, setSelectedRequest] = useState<RequestEvent | null>(
    null,
  )
  const [sheetOpen, setSheetOpen] = useState(false)

  // Filters
  const [methodFilter, setMethodFilter] = useState<string>('')
  const [pathFilter, setPathFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('')

  const pausedRef = useRef(paused)
  pausedRef.current = paused

  const { data: event, status: sseStatus } = useSse<RequestEvent>(
    '/events/traffic',
    { enabled: !paused },
  )

  // Accumulate events into buffer
  const prevEventRef = useRef<RequestEvent | null>(null)
  useEffect(() => {
    if (event && event !== prevEventRef.current && !pausedRef.current) {
      prevEventRef.current = event
      setBuffer((prev) => [event, ...prev].slice(0, MAX_BUFFER))
    }
  }, [event])

  const togglePause = useCallback(() => setPaused((p) => !p), [])

  const handleRowClick = useCallback((req: RequestEvent) => {
    setSelectedRequest(req)
    setSheetOpen(true)
  }, [])

  // Apply filters
  const filtered = useMemo(() => {
    return buffer.filter((req) => {
      if (methodFilter && req.method !== methodFilter) return false
      if (pathFilter && !req.path.toLowerCase().includes(pathFilter.toLowerCase()))
        return false
      if (statusFilter) {
        const range = parseInt(statusFilter, 10)
        if (Math.floor(req.status / 100) !== range / 100) return false
      }
      return true
    })
  }, [buffer, methodFilter, pathFilter, statusFilter])

  // Compute gauge values from buffer
  const gauges = useMemo(() => {
    if (buffer.length === 0) {
      return { rps: '0', latency: '- / - / -', errorRate: '0%', connections: '0' }
    }
    const latencies = buffer.map((r) => r.latency_ms).sort((a, b) => a - b)
    const p50 = latencies[Math.floor(latencies.length * 0.5)] ?? 0
    const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0
    const p99 = latencies[Math.floor(latencies.length * 0.99)] ?? 0
    const errors = buffer.filter((r) => r.status >= 500).length
    const rate = buffer.length > 0 ? ((errors / buffer.length) * 100).toFixed(2) : '0'
    return {
      rps: String(buffer.length),
      latency: `${p50}ms / ${p95}ms / ${p99}ms`,
      errorRate: `${rate}%`,
      connections: String(new Set(buffer.map((r) => r.upstream)).size),
    }
  }, [buffer])

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('live.title')}
        description={t('live.subtitle')}
        actions={
          <Button
            variant={paused ? 'default' : 'outline'}
            size="sm"
            onClick={togglePause}
          >
            {paused ? (
              <Play className="size-3.5" data-icon="inline-start" />
            ) : (
              <Pause className="size-3.5" data-icon="inline-start" />
            )}
            {paused ? t('live.resume') : t('live.pause')}
          </Button>
        }
      />

      {/* Real-time gauge stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={t('live.rps')}
          value={gauges.rps}
          icon={<Activity className="size-4" />}
        />
        <StatCard
          title={t('live.latency')}
          value={gauges.latency}
          icon={<Timer className="size-4" />}
        />
        <StatCard
          title={t('live.errorRate')}
          value={gauges.errorRate}
          icon={<AlertTriangle className="size-4" />}
        />
        <StatCard
          title={t('live.activeConnections')}
          value={gauges.connections}
          icon={<Users className="size-4" />}
        />
      </div>

      {/* Paused indicator */}
      {paused && (
        <div className="flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 text-sm text-yellow-700 dark:text-yellow-400">
          <Pause className="size-3.5" />
          {t('live.paused')}
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={methodFilter} onValueChange={(v) => setMethodFilter(v ?? '')}>
          <SelectTrigger size="sm" className="w-32">
            <SelectValue placeholder={t('filters.allMethods')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">{t('filters.allMethods')}</SelectItem>
            <SelectItem value="GET">GET</SelectItem>
            <SelectItem value="POST">POST</SelectItem>
            <SelectItem value="PUT">PUT</SelectItem>
            <SelectItem value="PATCH">PATCH</SelectItem>
            <SelectItem value="DELETE">DELETE</SelectItem>
            <SelectItem value="HEAD">HEAD</SelectItem>
            <SelectItem value="OPTIONS">OPTIONS</SelectItem>
          </SelectContent>
        </Select>

        <Input
          placeholder={t('filters.searchPlaceholder')}
          value={pathFilter}
          onChange={(e) => setPathFilter(e.target.value)}
          className="h-7 w-48 sm:w-64"
        />

        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? '')}>
          <SelectTrigger size="sm" className="w-32">
            <SelectValue placeholder={t('filters.allStatus')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">{t('filters.allStatus')}</SelectItem>
            <SelectItem value="200">2xx</SelectItem>
            <SelectItem value="300">3xx</SelectItem>
            <SelectItem value="400">4xx</SelectItem>
            <SelectItem value="500">5xx</SelectItem>
          </SelectContent>
        </Select>

        <Slot zone="traffic.live.filters" />
      </div>

      {/* Request stream table */}
      <div className="rounded-lg border">
        <ScrollArea className="h-[480px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('columns.time')}</TableHead>
                <TableHead>{t('columns.method')}</TableHead>
                <TableHead>{t('columns.path')}</TableHead>
                <TableHead>{t('columns.status')}</TableHead>
                <TableHead>{t('columns.latency')}</TableHead>
                <TableHead>{t('columns.upstream')}</TableHead>
                <Slot zone="traffic.live.columns" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length > 0 ? (
                filtered.map((req) => (
                  <TableRow
                    key={req.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => handleRowClick(req)}
                  >
                    <TableCell className="font-mono text-xs">
                      {format(new Date(req.timestamp), 'HH:mm:ss.SSS')}
                    </TableCell>
                    <TableCell className="font-mono font-semibold">
                      {req.method}
                    </TableCell>
                    <TableCell className="max-w-64 truncate font-mono text-muted-foreground">
                      {req.path}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`border-transparent ${statusColorClass(req.status)}`}
                      >
                        {req.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono">
                      {req.latency_ms}ms
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {req.upstream}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="h-32 text-center text-muted-foreground"
                  >
                    {sseStatus === 'connecting'
                      ? 'Connecting...'
                      : 'Waiting for traffic...'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </div>

      {/* Request detail sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{t('live.requestDetail')}</SheetTitle>
            {selectedRequest && (
              <SheetDescription>
                {selectedRequest.method} {selectedRequest.path}
              </SheetDescription>
            )}
          </SheetHeader>
          {selectedRequest && (
            <div className="space-y-4 overflow-auto px-4 pb-4">
              {/* Timing */}
              <div className="space-y-2">
                <h4 className="text-sm font-medium">{t('live.timing')}</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <span className="text-muted-foreground">
                    {t('columns.status')}
                  </span>
                  <Badge
                    variant="outline"
                    className={`w-fit border-transparent ${statusColorClass(selectedRequest.status)}`}
                  >
                    {selectedRequest.status}
                  </Badge>
                  <span className="text-muted-foreground">
                    {t('columns.latency')}
                  </span>
                  <span className="font-mono">
                    {selectedRequest.latency_ms}ms
                  </span>
                  <span className="text-muted-foreground">
                    {t('columns.time')}
                  </span>
                  <span className="font-mono text-xs">
                    {format(
                      new Date(selectedRequest.timestamp),
                      'HH:mm:ss.SSS',
                    )}
                  </span>
                </div>
              </div>

              {/* Upstream info */}
              <div className="space-y-2">
                <h4 className="text-sm font-medium">
                  {t('live.upstreamInfo')}
                </h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <span className="text-muted-foreground">
                    {t('columns.upstream')}
                  </span>
                  <span className="font-mono">{selectedRequest.upstream}</span>
                  <span className="text-muted-foreground">
                    {t('live.routeId')}
                  </span>
                  <span className="font-mono text-xs">
                    {selectedRequest.route_id}
                  </span>
                </div>
              </div>

              {/* Headers */}
              <div className="space-y-2">
                <h4 className="text-sm font-medium">{t('live.headers')}</h4>
                {selectedRequest.headers &&
                Object.keys(selectedRequest.headers).length > 0 ? (
                  <CodeBlock
                    value={selectedRequest.headers}
                    maxHeight="200px"
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t('live.noHeaders')}
                  </p>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
