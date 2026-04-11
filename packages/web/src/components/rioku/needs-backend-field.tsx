import { cn } from '@/lib/utils'

interface NeedsBackendFieldProps {
  children: React.ReactNode
  className?: string
  message?: string
}

/**
 * Wraps a form field that requires backend support not yet available.
 * Renders the field visually but disabled, with an explanatory message.
 */
function NeedsBackendField({
  children,
  className,
  message = 'Available in a future release',
}: NeedsBackendFieldProps) {
  return (
    <div
      data-testid="needs-backend-wrapper"
      className={cn('pointer-events-none relative opacity-50', className)}
    >
      {children}
      <p className="mt-1 text-xs italic text-muted-foreground">{message}</p>
    </div>
  )
}

export { NeedsBackendField }
export type { NeedsBackendFieldProps }
