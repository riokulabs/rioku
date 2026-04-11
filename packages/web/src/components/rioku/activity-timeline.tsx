import { useQuery } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { apiClient } from '@/lib/api'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'

interface ActivityEntry {
  action: string
  user: string
  timestamp: string
  detail: string
}

function getActivityDotColor(action: string): string {
  const lower = action.toLowerCase()
  if (lower.includes('created')) return 'bg-green-500'
  if (lower.includes('added')) return 'bg-green-500'
  if (lower.includes('updated')) return 'bg-blue-500'
  if (lower.includes('enabled') || lower.includes('disabled')) return 'bg-amber-500'
  if (lower.includes('attached') || lower.includes('detached')) return 'bg-purple-500'
  if (lower.includes('deleted') || lower.includes('removed')) return 'bg-red-500'
  return 'bg-muted-foreground'
}

type EntityType = 'route' | 'service' | 'global'

interface ActivityTimelineDataProps {
  entries: ActivityEntry[]
  title?: string
}

interface ActivityTimelineEntityProps {
  entityType: EntityType
  entityId: string
  title?: string
}

type ActivityTimelineProps = ActivityTimelineDataProps | ActivityTimelineEntityProps

function isEntityProps(props: ActivityTimelineProps): props is ActivityTimelineEntityProps {
  return 'entityType' in props
}

function ActivityTimeline(props: ActivityTimelineProps) {
  const entityQuery = useQuery({
    queryKey: ['activity', isEntityProps(props) ? props.entityType : '', isEntityProps(props) ? props.entityId : ''],
    queryFn: () => apiClient.get<ActivityEntry[]>(`/audit/${(props as ActivityTimelineEntityProps).entityType}s/${(props as ActivityTimelineEntityProps).entityId}`),
    enabled: isEntityProps(props),
  })

  const entries = isEntityProps(props) ? (entityQuery.data ?? []) : props.entries
  const title = props.title ?? 'Recent Changes'
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No activity recorded</p>
        ) : (
          <div className="divide-y divide-border/50">
            {entries.map((entry, i) => (
              <div key={i} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <div
                      data-activity-dot
                      className={cn('size-2 rounded-full', getActivityDotColor(entry.action))}
                    />
                    <span className="text-sm font-medium">{entry.action}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{entry.timestamp}</span>
                </div>
                <p className="ml-4 text-sm text-muted-foreground">{entry.detail}</p>
                <span className="ml-4 mt-0.5 inline-block text-xs text-muted-foreground/70">
                  by {entry.user}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export { ActivityTimeline }
export type { ActivityTimelineProps, ActivityEntry }
