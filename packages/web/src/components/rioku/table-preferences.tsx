import { SettingsIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'

interface ColumnVisibility {
  key: string
  header: string
  visible: boolean
  hideable: boolean
}

type Density = 'compact' | 'comfortable' | 'spacious'

interface TablePreferencesProps {
  columns: ColumnVisibility[]
  onColumnToggle: (key: string, visible: boolean) => void
  density: Density
  onDensityChange: (density: Density) => void
  pageSize: number
  onPageSizeChange: (size: number) => void
  pageSizeOptions?: number[]
}

const densityOptions: { value: Density; label: string }[] = [
  { value: 'compact', label: 'Compact' },
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'spacious', label: 'Spacious' },
]

function TablePreferences({
  columns,
  onColumnToggle,
  density,
  onDensityChange,
  pageSize,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
}: TablePreferencesProps) {
  const hideableColumns = columns.filter((c) => c.hideable)

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Table preferences"
          />
        }
      >
        <SettingsIcon className="size-4" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56">
        <PopoverHeader>
          <PopoverTitle>Preferences</PopoverTitle>
        </PopoverHeader>

        {hideableColumns.length > 0 && (
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              Columns
            </span>
            {hideableColumns.map((col) => (
              <label
                key={col.key}
                className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 text-sm hover:bg-muted"
              >
                <input
                  type="checkbox"
                  role="checkbox"
                  checked={col.visible}
                  onChange={(e) => onColumnToggle(col.key, e.target.checked)}
                  className="size-3.5 accent-primary"
                />
                {col.header}
              </label>
            ))}
          </div>
        )}

        <Separator />

        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">
            Density
          </span>
          <div className="flex gap-1">
            {densityOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={cn(
                  'flex-1 rounded-md px-2 py-1 text-xs transition-colors',
                  'focus-visible:ring-2 focus-visible:ring-ring',
                  density === opt.value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted hover:bg-muted/80',
                )}
                onClick={() => onDensityChange(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <Separator />

        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">
            Rows per page
          </span>
          <div className="flex gap-1">
            {pageSizeOptions.map((size) => (
              <button
                key={size}
                type="button"
                className={cn(
                  'flex-1 rounded-md px-2 py-1 text-xs transition-colors',
                  'focus-visible:ring-2 focus-visible:ring-ring',
                  pageSize === size
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted hover:bg-muted/80',
                )}
                onClick={() => onPageSizeChange(size)}
              >
                {size}
              </button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export { TablePreferences }
export type { TablePreferencesProps, ColumnVisibility, Density }
