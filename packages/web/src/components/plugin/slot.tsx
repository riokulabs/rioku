import { usePluginRegistry } from '@/lib/plugin-registry'

interface SlotProps {
  zone: string
  context?: unknown
}

function Slot({ zone, context: _context }: SlotProps) {
  const registry = usePluginRegistry()
  const injections = registry.getInjections(zone)

  if (injections.length === 0) return null

  return (
    <>
      {injections.map((injection, i) => {
        const Component = injection.component
        return (
          <Component
            key={`${injection.pluginId}-${injection.zone}-${i}`}
            zone={zone}
            pluginId={injection.pluginId}
          />
        )
      })}
    </>
  )
}

export { Slot }
export type { SlotProps }
