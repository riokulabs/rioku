import { useCallback, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import {
  RouteIcon,
  ServerIcon,
  ShieldIcon,
  UserIcon,
  KeyIcon,
  ClockIcon,
} from 'lucide-react'
import {
  CommandDialog,
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from '@/components/ui/command'
import { usePluginRegistry } from '@/lib/plugin-registry'
import { allNavItems } from '@/components/layout/app-sidebar'
import { useEntitySearch } from '@/hooks/use-entity-search'
import type { EntitySearchResult } from '@/hooks/use-entity-search'
import { useRecentlyViewed } from '@/hooks/use-recently-viewed'

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const ENTITY_ICONS: Record<EntitySearchResult['type'], typeof RouteIcon> = {
  route: RouteIcon,
  service: ServerIcon,
  policy: ShieldIcon,
  user: UserIcon,
  apiKey: KeyIcon,
}

const ENTITY_GROUP_LABELS: Record<EntitySearchResult['type'], string> = {
  route: 'Routes',
  service: 'Services',
  policy: 'Policies',
  user: 'Users',
  apiKey: 'API Keys',
}

/** Group nav items by their first path segment for display. */
function groupNavItems() {
  const groups: Record<string, typeof allNavItems> = {}
  for (const item of allNavItems) {
    const segments = item.path.split('/').filter(Boolean)
    const group = segments.length === 0 ? 'Overview' : segments[0].charAt(0).toUpperCase() + segments[0].slice(1)
    if (!groups[group]) groups[group] = []
    groups[group].push(item)
  }
  return groups
}

function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const registry = usePluginRegistry()
  const pluginNavItems = registry.getNavItems()
  const [searchQuery, setSearchQuery] = useState('')

  const { results: entityResults } = useEntitySearch(searchQuery)
  const { recentItems, addRecent } = useRecentlyViewed()

  const grouped = groupNavItems()

  // Group entity results by type
  const entityGroups: Record<string, EntitySearchResult[]> = {}
  for (const result of entityResults) {
    if (!entityGroups[result.type]) entityGroups[result.type] = []
    entityGroups[result.type].push(result)
  }

  const handleSelect = useCallback(
    (path: string) => {
      onOpenChange(false)
      setSearchQuery('')
      navigate({ to: path })
    },
    [navigate, onOpenChange],
  )

  const handleEntitySelect = useCallback(
    (result: EntitySearchResult) => {
      addRecent({
        type: result.type,
        id: result.id,
        name: result.name,
        path: result.path,
      })
      onOpenChange(false)
      setSearchQuery('')
      navigate({ to: result.path })
    },
    [navigate, onOpenChange, addRecent],
  )

  return (
    <CommandDialog open={open} onOpenChange={(isOpen) => {
      onOpenChange(isOpen)
      if (!isOpen) setSearchQuery('')
    }}>
      <Command shouldFilter={!searchQuery.trim()}>
        <CommandInput
          placeholder={t('actions.search', 'Search') + '...'}
          value={searchQuery}
          onValueChange={setSearchQuery}
        />
        <CommandList>
          <CommandEmpty>{t('empty.noResults', 'No results found')}</CommandEmpty>

          {/* Recently viewed -- shown when query is empty */}
          {!searchQuery.trim() && recentItems.length > 0 && (
            <>
              <CommandGroup heading="Recent">
                {recentItems.map((item) => {
                  const Icon = ENTITY_ICONS[item.type] ?? ClockIcon
                  return (
                    <CommandItem
                      key={`recent-${item.id}`}
                      value={`recent ${item.name} ${item.path}`}
                      onSelect={() => handleSelect(item.path)}
                    >
                      <Icon className="mr-2 size-4 shrink-0 text-muted-foreground" />
                      <div className="flex flex-col">
                        <span>{item.name}</span>
                        <span className="text-xs text-muted-foreground">{ENTITY_GROUP_LABELS[item.type]}</span>
                      </div>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
              <CommandSeparator />
            </>
          )}

          {/* Entity search results -- shown when query has text */}
          {searchQuery.trim() && Object.entries(entityGroups).map(([type, results]) => (
            <CommandGroup key={type} heading={ENTITY_GROUP_LABELS[type as EntitySearchResult['type']]}>
              {results.map((result) => {
                const Icon = ENTITY_ICONS[result.type]
                return (
                  <CommandItem
                    key={`entity-${result.id}`}
                    value={`${result.name} ${result.subtitle} ${result.path}`}
                    onSelect={() => handleEntitySelect(result)}
                  >
                    <Icon className="mr-2 size-4 shrink-0" />
                    <div className="flex flex-col">
                      <span>{result.name}</span>
                      <span className="text-xs text-muted-foreground">{result.subtitle}</span>
                    </div>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          ))}

          {/* Navigation items */}
          {Object.entries(grouped).map(([group, items]) => (
            <CommandGroup key={group} heading={group}>
              {items.map((item) => {
                const Icon = item.icon
                return (
                  <CommandItem
                    key={item.path}
                    value={`${t(item.label, item.label.split('.').pop() ?? '')} ${item.path}`}
                    onSelect={() => handleSelect(item.path)}
                  >
                    <Icon className="mr-2 size-4 shrink-0" />
                    <span>{t(item.label, item.label.split('.').pop() ?? '')}</span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          ))}
          {pluginNavItems.length > 0 && (
            <CommandGroup heading="Plugins">
              {pluginNavItems.map((item) => (
                <CommandItem
                  key={item.path}
                  value={`${item.label} ${item.path}`}
                  onSelect={() => handleSelect(item.path)}
                >
                  <span>{item.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}

export { CommandPalette }
