import type { ExpandedRole, AccessPolicy } from './api'

export interface PermissionMatrix {
  [resource: string]: {
    [action: string]: boolean
  }
  _sources?: {
    [resource: string]: {
      [action: string]: string
    }
  }
}

const ALL_RESOURCES = ['routes', 'services', 'policies', 'keys', 'users', 'roles', 'settings', 'cluster', 'plugins', 'audit', 'traffic', 'certificates']
const ALL_ACTIONS = ['view', 'create', 'update', 'delete', 'manage']

interface ComputeContext {
  roleIds?: string[]
  conditionsMet?: Record<string, boolean>
}

export function computeEffectivePermissions(
  assignedRoles: ExpandedRole[],
  allRoles: ExpandedRole[],
  accessPolicies: AccessPolicy[],
  context?: ComputeContext,
): PermissionMatrix {
  // 1. Build effective role set by walking parentRoleIds up the DAG
  const effectiveRoleIds = new Set<string>()
  const queue = [...assignedRoles.map((r) => r.id)]
  while (queue.length > 0) {
    const id = queue.shift()!
    if (effectiveRoleIds.has(id)) continue
    effectiveRoleIds.add(id)
    const role = allRoles.find((r) => r.id === id)
    if (role?.parentRoleIds) {
      for (const pid of role.parentRoleIds) queue.push(pid)
    }
  }

  // 2. Collect all rules from effective roles
  const effectiveRoles = allRoles.filter((r) => effectiveRoleIds.has(r.id))
  const allRules = effectiveRoles.flatMap((r) => (r.rules ?? []).map((rule) => ({ ...rule, _source: r.name })))

  // 3. Initialize matrix
  const matrix: PermissionMatrix = {}
  const sources: Record<string, Record<string, string>> = {}
  for (const resource of ALL_RESOURCES) {
    matrix[resource] = {}
    sources[resource] = {}
    for (const action of ALL_ACTIONS) {
      matrix[resource][action] = false
      sources[resource][action] = ''
    }
  }

  // 4. Apply allow rules
  for (const rule of allRules) {
    if (rule.effect === 'allow') {
      for (const action of rule.actions) {
        if (matrix[rule.resource] && action in matrix[rule.resource]) {
          matrix[rule.resource][action] = true
          sources[rule.resource][action] = rule._source
        }
      }
    }
  }

  // 5. Apply deny rules (deny overrides allow)
  for (const rule of allRules) {
    if (rule.effect === 'deny') {
      for (const action of rule.actions) {
        if (matrix[rule.resource] && action in matrix[rule.resource]) {
          matrix[rule.resource][action] = false
          sources[rule.resource][action] = `${rule._source} (denied)`
        }
      }
    }
  }

  // 6. Apply access policies in priority order
  const sortedPolicies = [...accessPolicies].sort((a, b) => a.priority - b.priority)
  for (const policy of sortedPolicies) {
    if (!policy.enabled) continue
    const conditionsMet = context?.conditionsMet?.[policy.id]
    if (conditionsMet === undefined || !conditionsMet) continue

    const targetMatches = policy.targetType === 'roles'
      ? policy.targetIds.some((id) => context?.roleIds?.includes(id))
      : false // user-level targeting not implemented in client-side computation

    if (targetMatches) {
      for (const resource of ALL_RESOURCES) {
        for (const action of ALL_ACTIONS) {
          if (policy.effect === 'deny') {
            matrix[resource][action] = false
            sources[resource][action] = policy.name
          } else {
            matrix[resource][action] = true
            sources[resource][action] = policy.name
          }
        }
      }
    }
  }

  matrix._sources = sources
  return matrix
}
