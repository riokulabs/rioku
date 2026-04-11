interface TooltipPayload {
  name: string
  value: number
  color: string
}

interface ChartTooltipProps {
  active?: boolean
  label?: string
  payload?: TooltipPayload[]
}

function ChartTooltip({ active, label, payload }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null

  const maxValue = Math.max(...payload.map((p) => p.value))

  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">{label}</p>
      <div className="space-y-1">
        {payload.map((entry) => (
          <div
            key={entry.name}
            data-testid="tooltip-row"
            className={entry.value === maxValue ? 'font-semibold' : ''}
          >
            <div className="flex items-center gap-2">
              <span
                data-testid="tooltip-dot"
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              <span className="text-muted-foreground">{entry.name}</span>
              <span className="ml-auto tabular-nums">
                {entry.value.toLocaleString()}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export { ChartTooltip }
export type { ChartTooltipProps, TooltipPayload }
