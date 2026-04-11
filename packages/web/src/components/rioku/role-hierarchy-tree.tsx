import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import type { ExpandedRole } from '@/lib/api'

interface RoleHierarchyTreeProps {
  role: ExpandedRole
  allRoles: ExpandedRole[]
  onParentChange?: (parentIds: string[]) => void
  readOnly?: boolean
}

export function RoleHierarchyTree({ role, allRoles, onParentChange, readOnly }: RoleHierarchyTreeProps) {
  const parentRoles = allRoles.filter((r) => (role.parentRoleIds ?? []).includes(r.id))
  const childRoles = allRoles.filter((r) => (role.childRoleIds ?? []).includes(r.id))

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Parent roles (inherits permissions from)</Label>
        <div className="flex flex-wrap gap-2">
          {parentRoles.length > 0 ? (
            parentRoles.map((r) => (
              <Badge key={r.id} variant="outline">{r.name}</Badge>
            ))
          ) : (
            <span className="text-sm text-muted-foreground">No parent roles</span>
          )}
        </div>
      </div>
      <div className="space-y-2">
        <Label>Child roles (inherit this role's permissions)</Label>
        <div className="flex flex-wrap gap-2">
          {childRoles.length > 0 ? (
            childRoles.map((r) => (
              <Badge key={r.id} variant="secondary">{r.name}</Badge>
            ))
          ) : (
            <span className="text-sm text-muted-foreground">No child roles</span>
          )}
        </div>
      </div>
      {!readOnly && (
        <p className="text-xs text-muted-foreground">
          Role hierarchy management requires backend support. Coming soon.
        </p>
      )}
    </div>
  )
}
