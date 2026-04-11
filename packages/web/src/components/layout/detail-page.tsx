import { Link } from '@tanstack/react-router'
import { ArrowLeftIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

export interface DetailTab {
  /** URL-safe tab ID for ?tab= param */
  id: string
  /** Display label */
  label: string
  /** Tab panel content */
  content: React.ReactNode
}

export interface DetailPageProps {
  title: string
  subtitle?: string
  /** e.g. "Back to Routes" */
  backLabel: string
  /** e.g. "/config/routes" */
  backTo: string
  tabs?: DetailTab[]
  defaultTab?: string
  /** Toolbar area right of title (edit/save/cancel buttons) */
  toolbar?: React.ReactNode
  /** Right sidebar metadata */
  metadata?: React.ReactNode
  /** Main content when no tabs */
  children?: React.ReactNode
  className?: string
}

function getTabFromUrl(): string | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  return params.get('tab')
}

function setTabInUrl(tabId: string) {
  if (typeof window === 'undefined') return
  const params = new URLSearchParams(window.location.search)
  params.set('tab', tabId)
  const url = `${window.location.pathname}?${params.toString()}`
  window.history.replaceState(null, '', url)
}

function DetailPage({
  title,
  subtitle,
  backLabel,
  backTo,
  tabs,
  defaultTab,
  toolbar,
  metadata,
  children,
  className,
}: DetailPageProps) {
  const activeTab = getTabFromUrl() ?? defaultTab ?? tabs?.[0]?.id

  function handleTabChange(value: unknown) {
    if (typeof value === 'string') {
      setTabInUrl(value)
    }
  }

  const contentArea = tabs ? (
    <Tabs value={activeTab} onValueChange={handleTabChange}>
      <TabsList variant="line">
        {tabs.map((tab) => (
          <TabsTrigger key={tab.id} value={tab.id}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent key={tab.id} value={tab.id}>
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  ) : (
    children
  )

  return (
    <div className={cn('flex flex-col gap-6', className)}>
      {/* Back navigation */}
      <Link
        to={backTo}
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" />
        {backLabel}
      </Link>

      {/* Header: title + optional toolbar */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && (
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {toolbar && (
          <div className="flex shrink-0 items-center gap-2">{toolbar}</div>
        )}
      </div>

      {/* Body: content + optional metadata sidebar */}
      {metadata ? (
        <div className="flex flex-col gap-6 lg:flex-row">
          <div className="min-w-0 flex-1">{contentArea}</div>
          <aside className="w-full shrink-0 lg:w-72">{metadata}</aside>
        </div>
      ) : (
        contentArea
      )}
    </div>
  )
}

export { DetailPage }
