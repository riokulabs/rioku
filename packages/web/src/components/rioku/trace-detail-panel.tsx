import { useState } from 'react'
import { ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'

import { cn } from '@/lib/utils'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { CodeBlock } from '@/components/rioku/code-block'
import type { TraceDetail } from '@/lib/api'

interface TraceDetailPanelProps {
  trace: TraceDetail | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function statusColorClass(status: number): string {
  if (status < 300) return 'bg-green-500/10 text-green-700 dark:text-green-400'
  if (status < 400) return 'bg-blue-500/10 text-blue-700 dark:text-blue-400'
  if (status < 500) return 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400'
  return 'bg-red-500/10 text-red-700 dark:text-red-400'
}

function policyResultColor(result: string): string {
  if (result === 'pass') return 'bg-green-500/10 text-green-700 dark:text-green-400 border-transparent'
  if (result === 'fail') return 'bg-red-500/10 text-red-700 dark:text-red-400 border-transparent'
  return 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-transparent'
}

interface CollapsibleSectionProps {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}

function CollapsibleSection({ title, defaultOpen = true, children }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="border-b last:border-b-0">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-2.5 text-sm font-medium hover:bg-muted/50"
        onClick={() => setOpen((o) => !o)}
      >
        {title}
        {open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
      </button>
      {open && <div className="space-y-2 px-4 pb-3">{children}</div>}
    </div>
  )
}

function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-all">{children}</span>
    </div>
  )
}

function TraceDetailPanel({ trace, open, onOpenChange }: TraceDetailPanelProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg p-0">
        {trace && (
          <>
            <SheetHeader className="px-4 pt-4 pb-2 border-b">
              <SheetTitle>Trace Detail</SheetTitle>
              <SheetDescription>
                {trace.method} {trace.path}
              </SheetDescription>
            </SheetHeader>
            <ScrollArea className="h-[calc(100vh-80px)]" data-testid="trace-detail">
              {/* REQUEST */}
              <CollapsibleSection title="Request">
                <KV label="Method">
                  <span className="font-mono font-semibold">{trace.method}</span>
                </KV>
                <KV label="Path">
                  <span className="font-mono text-xs">{trace.path}</span>
                </KV>
                <KV label="Host">
                  <span className="font-mono text-xs">{trace.host}</span>
                </KV>
                {Object.keys(trace.queryParams).length > 0 && (
                  <div className="mt-1">
                    <span className="text-xs font-medium text-muted-foreground">Query params</span>
                    <CodeBlock value={trace.queryParams} maxHeight="120px" />
                  </div>
                )}
                {Object.keys(trace.requestHeaders).length > 0 && (
                  <div className="mt-1">
                    <span className="text-xs font-medium text-muted-foreground">Headers</span>
                    <CodeBlock value={trace.requestHeaders} maxHeight="200px" />
                  </div>
                )}
              </CollapsibleSection>

              {/* RESPONSE */}
              <CollapsibleSection title="Response">
                <KV label="Status">
                  <Badge variant="outline" className={cn('border-transparent', statusColorClass(trace.status))}>
                    {trace.status}
                  </Badge>
                </KV>
                <KV label="Size">
                  <span className="font-mono">{trace.responseSize.toLocaleString()} B</span>
                </KV>
                <KV label="Total">
                  <span className="font-mono">{trace.totalDurationMs}ms</span>
                </KV>
                <KV label="Upstream">
                  <span className="font-mono">{trace.upstreamDurationMs}ms</span>
                </KV>
                <KV label="Overhead">
                  <span className="font-mono">{trace.overheadMs}ms</span>
                </KV>
                {Object.keys(trace.responseHeaders).length > 0 && (
                  <div className="mt-1">
                    <span className="text-xs font-medium text-muted-foreground">Headers</span>
                    <CodeBlock value={trace.responseHeaders} maxHeight="200px" />
                  </div>
                )}
              </CollapsibleSection>

              {/* ROUTING */}
              <CollapsibleSection title="Routing">
                <KV label="Route">
                  <span className="font-mono text-xs">{trace.routeName} ({trace.routeId})</span>
                </KV>
                <KV label="Service">
                  <span className="font-mono text-xs">{trace.serviceName} ({trace.serviceId})</span>
                </KV>
                <KV label="Upstream">
                  <span className="font-mono text-xs">{trace.upstream}</span>
                </KV>
              </CollapsibleSection>

              {/* POLICIES */}
              <CollapsibleSection title="Policies">
                {trace.policies.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No policies evaluated</p>
                ) : (
                  <div className="space-y-2">
                    {trace.policies.map((p) => (
                      <div key={p.policyId} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="font-mono">{p.policyName}</span>
                          <Badge variant="secondary" className="text-[10px]">{p.policyType}</Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={policyResultColor(p.result)}>
                            {p.result}
                          </Badge>
                          {p.rateLimitRemaining != null && (
                            <span className="text-xs text-muted-foreground">
                              {p.rateLimitRemaining} remaining
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CollapsibleSection>

              {/* IDENTITY */}
              {trace.identity && (
                <CollapsibleSection title="Identity">
                  <KV label="Actor type">
                    <Badge variant="secondary">{trace.identity.actorType}</Badge>
                  </KV>
                  {trace.identity.actorId && (
                    <KV label="Actor ID">
                      <span className="font-mono text-xs">{trace.identity.actorId}</span>
                    </KV>
                  )}
                  {trace.identity.apiKeyPrefix && (
                    <KV label="Key prefix">
                      <span className="font-mono text-xs">{trace.identity.apiKeyPrefix}</span>
                    </KV>
                  )}
                  {trace.identity.sessionId && (
                    <KV label="Session ID">
                      <span className="font-mono text-xs">{trace.identity.sessionId}</span>
                    </KV>
                  )}
                </CollapsibleSection>
              )}

              {/* AI */}
              {trace.ai && (
                <CollapsibleSection title="AI">
                  <KV label="Provider">
                    <span>{trace.ai.provider}</span>
                  </KV>
                  <KV label="Model">
                    <span className="font-mono text-xs">{trace.ai.model}</span>
                  </KV>
                  <KV label="Input tokens">
                    <span className="font-mono">{trace.ai.inputTokens.toLocaleString()}</span>
                  </KV>
                  <KV label="Output tokens">
                    <span className="font-mono">{trace.ai.outputTokens.toLocaleString()}</span>
                  </KV>
                  <KV label="Cache tokens">
                    <span className="font-mono">{trace.ai.cacheTokens.toLocaleString()}</span>
                  </KV>
                  <KV label="Est. cost">
                    <span className="font-mono">{`$${trace.ai.estimatedCostUsd.toFixed(2)}`}</span>
                  </KV>
                  <KV label="Finish reason">
                    <Badge variant="secondary">{trace.ai.finishReason}</Badge>
                  </KV>
                  {trace.ai.toolCalls && trace.ai.toolCalls.length > 0 && (
                    <KV label="Tool calls">
                      <div className="flex flex-wrap gap-1">
                        {trace.ai.toolCalls.map((tc) => (
                          <Badge key={tc} variant="outline" className="text-[10px]">{tc}</Badge>
                        ))}
                      </div>
                    </KV>
                  )}
                </CollapsibleSection>
              )}

              {/* OTEL */}
              {trace.otel && (
                <CollapsibleSection title="OTEL">
                  <KV label="Trace ID">
                    {trace.otel.externalViewerUrl ? (
                      <a
                        href={trace.otel.externalViewerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline"
                      >
                        {trace.otel.traceId}
                        <ExternalLink className="size-3" />
                      </a>
                    ) : (
                      <span className="font-mono text-xs">{trace.otel.traceId}</span>
                    )}
                  </KV>
                  <KV label="Span ID">
                    <span className="font-mono text-xs">{trace.otel.spanId}</span>
                  </KV>
                </CollapsibleSection>
              )}
            </ScrollArea>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

export { TraceDetailPanel }
export type { TraceDetailPanelProps }
