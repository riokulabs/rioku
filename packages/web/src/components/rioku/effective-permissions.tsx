import { useState, useMemo } from 'react'
import { ChevronDownIcon, CheckIcon, XIcon, MinusIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { computeEffectivePermissions } from '@/lib/permissions'
import type { ExpandedRole, AccessPolicy } from '@/lib/api'

const ALL_RESOURCES = ['routes', 'services', 'policies', 'keys', 'users', 'roles', 'settings', 'cluster', 'plugins', 'audit', 'traffic', 'certificates']
const ALL_ACTIONS = ['view', 'create', 'update', 'delete', 'manage']

interface EffectivePermissionsPanelProps {
  assignedRoles: ExpandedRole[]
  allRoles: ExpandedRole[]
  accessPolicies: AccessPolicy[]
  context?: { roleIds?: string[]; conditionsMet?: Record<string, boolean> }
}

export function EffectivePermissionsPanel({
  assignedRoles, allRoles, accessPolicies, context,
}: EffectivePermissionsPanelProps) {
  const [open, setOpen] = useState(false)

  const matrix = useMemo(
    () => computeEffectivePermissions(assignedRoles, allRoles, accessPolicies, context),
    [assignedRoles, allRoles, accessPolicies, context],
  )

  const { count, resources } = useMemo(() => {
    let c = 0
    const res = new Set<string>()
    for (const [resource, actions] of Object.entries(matrix)) {
      if (resource === '_sources') continue
      for (const allowed of Object.values(actions as Record<string, boolean>)) {
        if (allowed) { c++; res.add(resource) }
      }
    }
    return { count: c, resources: res.size }
  }, [matrix])

  return (
    <div className="rounded-lg border">
      <button
        type="button"
        className="flex w-full items-center justify-between p-4 text-left text-sm font-medium hover:bg-accent/50 transition-colors"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span>
          Effective permissions
          <span className="ml-2 text-muted-foreground font-normal">
            {count} permissions across {resources} resources
          </span>
        </span>
        <ChevronDownIcon className={cn('size-4 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="border-t p-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="text-left font-medium py-1 pr-4">Resource</th>
                {ALL_ACTIONS.map((a) => (
                  <th key={a} className="text-center font-medium py-1 px-2 capitalize">{a}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ALL_RESOURCES.map((resource) => (
                <tr key={resource} className="border-t">
                  <td className="py-1.5 pr-4 capitalize">{resource}</td>
                  {ALL_ACTIONS.map((action) => {
                    const allowed = (matrix[resource] as Record<string, boolean>)?.[action]
                    const source = (matrix._sources as Record<string, Record<string, string>>)?.[resource]?.[action]
                    return (
                      <td key={action} className="text-center py-1.5 px-2" title={source || undefined}>
                        {allowed === true ? (
                          <CheckIcon className="size-4 text-green-500 mx-auto" />
                        ) : allowed === false && source ? (
                          <XIcon className="size-4 text-red-500 mx-auto" />
                        ) : (
                          <MinusIcon className="size-4 text-muted-foreground mx-auto" />
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
