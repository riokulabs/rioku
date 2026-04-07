import { cn } from '@/lib/utils'

interface SparklineProps {
  data: number[]
  width?: number
  height?: number
  color?: string
  className?: string
}

function Sparkline({
  data,
  width = 80,
  height = 24,
  color = 'currentColor',
  className,
}: SparklineProps) {
  if (data.length < 2) return null

  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1

  const padding = 1
  const innerWidth = width - padding * 2
  const innerHeight = height - padding * 2

  const points = data.map((value, i) => {
    const x = padding + (i / (data.length - 1)) * innerWidth
    const y = padding + innerHeight - ((value - min) / range) * innerHeight
    return `${x},${y}`
  })

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      className={cn('text-primary', className)}
    >
      <polyline
        points={points.join(' ')}
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}

export { Sparkline }
export type { SparklineProps }
