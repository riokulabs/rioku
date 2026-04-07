import { useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import {
  CommandDialog,
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command'
import { usePluginRegistry } from '@/lib/plugin-registry'
import { allNavItems } from '@/components/layout/app-sidebar'

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
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

  const grouped = groupNavItems()

  const handleSelect = useCallback(
    (path: string) => {
      onOpenChange(false)
      navigate({ to: path })
    },
    [navigate, onOpenChange],
  )

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <Command>
        <CommandInput placeholder={t('actions.search', 'Search') + '...'} />
        <CommandList>
          <CommandEmpty>{t('empty.noResults', 'No results found')}</CommandEmpty>
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
