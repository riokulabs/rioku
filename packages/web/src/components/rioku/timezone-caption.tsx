interface TimezoneCaptionProps {
  timezone?: string
  className?: string
}

function TimezoneCaption({ timezone = 'UTC', className }: TimezoneCaptionProps) {
  return (
    <p className={`mt-1 text-[10px] text-muted-foreground ${className ?? ''}`}>
      Times shown in {timezone}
    </p>
  )
}

export { TimezoneCaption }
export type { TimezoneCaptionProps }
