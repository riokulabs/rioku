import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'

interface SettingsFieldProps {
  label: string
  description?: string
  needsBackend?: boolean
  readOnly?: boolean
  children: React.ReactNode
  className?: string
}

function SettingsField({
  label,
  description,
  needsBackend = false,
  readOnly = false,
  children,
  className,
}: SettingsFieldProps) {
  return (
    <div className={className}>
      <div className="flex items-center gap-2 mb-1.5">
        <Label>{label}</Label>
        {readOnly && (
          <Badge variant="outline" className="text-xs">
            Read-only
          </Badge>
        )}
        {needsBackend && (
          <Badge variant="outline" className="text-xs text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-700">
            Requires backend API
          </Badge>
        )}
      </div>
      {description && (
        <p className="text-sm text-muted-foreground mb-2">{description}</p>
      )}
      <div className={needsBackend ? 'opacity-60 pointer-events-none' : ''}>
        {children}
      </div>
    </div>
  )
}

export { SettingsField }
export type { SettingsFieldProps }
