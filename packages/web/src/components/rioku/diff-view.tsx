import { cn } from '@/lib/utils'
import { MinusIcon, PlusIcon, ArrowRightIcon } from 'lucide-react'

export interface DiffChange {
  field: string
  oldValue: string | null
  newValue: string | null
}

interface DiffViewProps {
  changes: DiffChange[]
  className?: string
}

function DiffView({ changes, className }: DiffViewProps) {
  if (changes.length === 0) {
    return (
      <div className={cn('py-8 text-center text-sm text-muted-foreground', className)}>
        No changes detected
      </div>
    )
  }

  return (
    <div className={cn('space-y-2', className)}>
      {changes.map((change, i) => (
        <div
          key={i}
          className="flex items-start gap-3 rounded-md border p-3 text-sm"
        >
          <span className="min-w-[120px] font-medium text-foreground">
            {change.field}
          </span>
          <div className="flex flex-1 items-center gap-2 text-muted-foreground">
            {change.oldValue === null ? (
              <div data-testid="diff-added" className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
                <PlusIcon className="size-3.5" />
                <span className="font-mono text-xs">{change.newValue}</span>
              </div>
            ) : change.newValue === null ? (
              <div data-testid="diff-removed" className="flex items-center gap-1.5 text-red-600 dark:text-red-400">
                <MinusIcon className="size-3.5" />
                <span className="font-mono text-xs line-through">{change.oldValue}</span>
              </div>
            ) : (
              <>
                <span className="font-mono text-xs text-red-600 line-through dark:text-red-400">
                  {change.oldValue}
                </span>
                <ArrowRightIcon className="size-3.5 shrink-0" />
                <span className="font-mono text-xs text-green-600 dark:text-green-400">
                  {change.newValue}
                </span>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

export { DiffView }
export type { DiffViewProps }
