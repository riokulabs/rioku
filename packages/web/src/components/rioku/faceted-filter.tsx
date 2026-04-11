import { useState } from 'react'
import { FilterIcon, CheckIcon, XIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'

interface FilterOption {
  label: string
  value: string
  icon?: React.ReactNode
}

interface FilterColumn {
  key: string
  label: string
  options: FilterOption[]
}

interface FacetedFilterProps {
  column: FilterColumn
  selected: string[]
  onChange: (values: string[]) => void
}

function FacetedFilter({ column, selected, onChange }: FacetedFilterProps) {
  const [open, setOpen] = useState(false)

  const toggleValue = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value))
    } else {
      onChange([...selected, value])
    }
  }

  const clearFilter = () => {
    onChange([])
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className={cn(
              'h-7 gap-1 border-dashed',
              selected.length > 0 && 'border-primary/50',
            )}
          />
        }
      >
        <FilterIcon className="size-3" />
        {column.label}
        {selected.length > 0 && (
          <>
            <Separator orientation="vertical" className="mx-0.5 h-4" />
            <Badge variant="secondary" className="h-5 rounded px-1 text-xs">
              {selected.length}
            </Badge>
          </>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1">
        <div className="space-y-0.5">
          {column.options.map((option) => {
            const isSelected = selected.includes(option.value)
            return (
              <button
                key={option.value}
                type="button"
                role="checkbox"
                aria-checked={isSelected}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none',
                  'hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring',
                  isSelected && 'bg-muted/50',
                )}
                onClick={() => toggleValue(option.value)}
              >
                <span
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded-sm border',
                    isSelected
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-muted-foreground/30',
                  )}
                >
                  {isSelected && <CheckIcon className="size-3" />}
                </span>
                {option.icon && (
                  <span className="flex size-4 items-center justify-center text-muted-foreground">
                    {option.icon}
                  </span>
                )}
                <span className="flex-1 text-left">{option.label}</span>
              </button>
            )
          })}
        </div>
        {selected.length > 0 && (
          <>
            <Separator className="my-1" />
            <button
              type="button"
              className="flex w-full items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              onClick={clearFilter}
            >
              <XIcon className="size-3" />
              Clear filter
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

export { FacetedFilter }
export type { FacetedFilterProps, FilterColumn, FilterOption }
