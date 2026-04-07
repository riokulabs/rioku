import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'

interface StatCardProps {
  title: string
  value: React.ReactNode
  icon: React.ReactNode
  trend?: { value: string; direction: 'up' | 'down' }
  className?: string
}

function StatCard({ title, value, icon, trend, className }: StatCardProps) {
  return (
    <Card className={cn('gap-0 py-0', className)}>
      <CardContent className="flex items-center gap-4 py-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          {icon}
        </div>
        <div className="flex-1 space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{title}</p>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-semibold tracking-tight">
              {value}
            </span>
            {trend && (
              <span
                className={cn(
                  'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-medium',
                  trend.direction === 'up'
                    ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                    : 'bg-red-500/10 text-red-600 dark:text-red-400',
                )}
              >
                {trend.direction === 'up' ? (
                  <ArrowUpIcon className="size-3" />
                ) : (
                  <ArrowDownIcon className="size-3" />
                )}
                {trend.value}
              </span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export { StatCard }
export type { StatCardProps }
