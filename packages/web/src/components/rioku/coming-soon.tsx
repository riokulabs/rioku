import { Construction } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

interface ComingSoonProps {
  feature: string
  description?: string
  issueUrl?: string
}

function ComingSoon({ feature, description, issueUrl }: ComingSoonProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed p-12 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <Construction className="size-6 text-muted-foreground" />
      </div>
      <div className="space-y-2">
        <h2 className="text-lg font-medium">{feature}</h2>
        <Badge variant="secondary">Coming Soon</Badge>
      </div>
      {description && (
        <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      )}
      {issueUrl && (
        <a
          href={issueUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-primary hover:underline"
        >
          Track progress on GitHub
        </a>
      )}
    </div>
  )
}

export { ComingSoon }
export type { ComingSoonProps }
