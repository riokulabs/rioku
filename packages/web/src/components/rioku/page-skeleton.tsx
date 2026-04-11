import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'

type PageSkeletonVariant = 'stat-cards' | 'table' | 'chart' | 'detail' | 'form'

interface PageSkeletonProps {
  variant: PageSkeletonVariant
  /** Number of rows for the table variant (default: 5) */
  rows?: number
  /** Number of cards for the stat-cards variant (default: 4) */
  cards?: number
  className?: string
}

function StatCardsSkeleton({ cards = 4, className }: { cards?: number; className?: string }) {
  return (
    <div className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-4', className)} data-testid="skeleton-stat-cards">
      {Array.from({ length: cards }, (_, i) => (
        <div key={i} className="flex items-center gap-4 rounded-xl p-4 ring-1 ring-foreground/10">
          <Skeleton className="size-10 shrink-0 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-16" />
          </div>
        </div>
      ))}
    </div>
  )
}

function TableSkeleton({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-3', className)} data-testid="skeleton-table">
      {/* Header */}
      <div className="flex items-center gap-4 border-b pb-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-4 w-20" />
      </div>
      {/* Rows */}
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 py-2">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  )
}

function ChartSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('space-y-3', className)} data-testid="skeleton-chart">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-64 w-full rounded-lg" />
    </div>
  )
}

function DetailSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('space-y-6', className)} data-testid="skeleton-detail">
      <div className="rounded-xl p-4 ring-1 ring-foreground/10">
        <div className="space-y-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex items-start gap-4">
              <Skeleton className="h-4 w-24 shrink-0" />
              <Skeleton className="h-4 w-48" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function FormSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('space-y-6', className)} data-testid="skeleton-form">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-9 w-full rounded-md" />
        </div>
      ))}
      <Skeleton className="h-9 w-24 rounded-md" />
    </div>
  )
}

const variantMap: Record<PageSkeletonVariant, React.FC<{ rows?: number; cards?: number; className?: string }>> = {
  'stat-cards': StatCardsSkeleton,
  table: TableSkeleton,
  chart: ChartSkeleton,
  detail: DetailSkeleton,
  form: FormSkeleton,
}

function PageSkeleton({ variant, rows, cards, className }: PageSkeletonProps) {
  const Component = variantMap[variant]
  return <Component rows={rows} cards={cards} className={className} />
}

export { PageSkeleton }
export type { PageSkeletonProps, PageSkeletonVariant }
