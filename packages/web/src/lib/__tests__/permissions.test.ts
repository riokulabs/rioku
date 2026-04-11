import { describe, it, expect } from 'vitest'
import { computeEffectivePermissions } from '../permissions'
import type { ExpandedRole, AccessPolicy } from '../api'

const viewerRole: ExpandedRole = {
  id: 'viewer', name: 'viewer', description: '', isBuiltin: true,
  permissions: [], createdAt: '', updatedAt: '',
  rules: [
    { id: '1', resource: 'routes', actions: ['view'], scope: 'all', effect: 'allow' },
    { id: '2', resource: 'services', actions: ['view'], scope: 'all', effect: 'allow' },
  ],
}

const operatorRole: ExpandedRole = {
  id: 'operator', name: 'operator', description: '', isBuiltin: true,
  permissions: [], createdAt: '', updatedAt: '',
  parentRoleIds: ['viewer'],
  rules: [
    { id: '3', resource: 'routes', actions: ['create', 'update', 'delete'], scope: 'all', effect: 'allow' },
    { id: '4', resource: 'services', actions: ['create', 'update', 'delete'], scope: 'all', effect: 'allow' },
  ],
}

describe('computeEffectivePermissions', () => {
  it('grants no permissions with no roles', () => {
    const result = computeEffectivePermissions([], [], [])
    expect(result.routes.view).toBe(false)
  })

  it('grants view permission from viewer role', () => {
    const result = computeEffectivePermissions([viewerRole], [viewerRole], [])
    expect(result.routes.view).toBe(true)
    expect(result.routes.create).toBe(false)
  })

  it('inherits parent role permissions', () => {
    const result = computeEffectivePermissions([operatorRole], [viewerRole, operatorRole], [])
    expect(result.routes.view).toBe(true)
    expect(result.routes.create).toBe(true)
  })

  it('deny rules override allow rules', () => {
    const denyRole: ExpandedRole = {
      id: 'deny-test', name: 'deny-test', description: '', isBuiltin: false,
      permissions: [], createdAt: '', updatedAt: '',
      rules: [
        { id: '5', resource: 'routes', actions: ['delete'], scope: 'all', effect: 'deny' },
      ],
    }
    const result = computeEffectivePermissions(
      [operatorRole, denyRole], [viewerRole, operatorRole, denyRole], [],
    )
    expect(result.routes.delete).toBe(false)
    expect(result.routes.create).toBe(true)
  })

  it('access policies override role permissions', () => {
    const denyPolicy: AccessPolicy = {
      id: 'ap1', name: 'deny-after-hours', description: '',
      effect: 'deny', targetType: 'roles', targetIds: ['operator'],
      conditions: [{ type: 'time', config: {} }],
      priority: 1, enabled: true, createdAt: '', updatedAt: '',
    }
    const result = computeEffectivePermissions(
      [operatorRole], [viewerRole, operatorRole], [denyPolicy],
      { roleIds: ['operator'], conditionsMet: { ap1: true } },
    )
    expect(result.routes.create).toBe(false)
  })

  it('returns sources for each permission cell', () => {
    const result = computeEffectivePermissions([viewerRole], [viewerRole], [])
    expect(result._sources?.routes?.view).toContain('viewer')
  })
})
