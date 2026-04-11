import type { UserInfo, MeResponse, SessionInfo, Role, ExpandedRole, PermissionRule } from '@/lib/api'

export const mockRoles: Role[] = [
  {
    id: 'role-admin',
    name: 'admin',
    description: 'Full administrative access',
    isBuiltin: true,
    permissions: ['*'],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'role-operator',
    name: 'operator',
    description: 'Manage routes, services, and policies',
    isBuiltin: true,
    permissions: ['config:read', 'config:write', 'traffic:read', 'audit:read'],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'role-viewer',
    name: 'viewer',
    description: 'Read-only access to configuration and traffic',
    isBuiltin: true,
    permissions: ['config:read', 'traffic:read', 'audit:read'],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
]

export const mockUsers: UserInfo[] = [
  {
    id: 'user-admin',
    username: 'admin',
    displayName: 'Root Admin',
    email: 'admin@example.com',
    roles: ['admin'],
    permissions: ['*'],
    totpEnabled: true,
    forcePasswordChange: false,
    status: 'active',
    lastLogin: '2026-04-11T08:30:00Z',
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'user-alice',
    username: 'alice',
    displayName: 'Alice Chen',
    email: 'alice@example.com',
    roles: ['operator'],
    permissions: ['config:read', 'config:write', 'traffic:read', 'audit:read'],
    totpEnabled: true,
    forcePasswordChange: false,
    status: 'active',
    lastLogin: '2026-04-10T17:00:00Z',
    createdAt: '2026-02-15T10:00:00Z',
  },
  {
    id: 'user-bob',
    username: 'bob',
    displayName: 'Bob Martinez',
    email: 'bob@example.com',
    roles: ['viewer'],
    permissions: ['config:read', 'traffic:read', 'audit:read'],
    totpEnabled: false,
    forcePasswordChange: false,
    status: 'active',
    lastLogin: '2026-04-09T12:00:00Z',
    createdAt: '2026-03-01T14:00:00Z',
  },
  {
    id: 'user-carol',
    username: 'carol',
    displayName: 'Carol Kim',
    email: 'carol@example.com',
    roles: ['operator'],
    permissions: ['config:read', 'config:write', 'traffic:read', 'audit:read'],
    totpEnabled: false,
    forcePasswordChange: true,
    status: 'active',
    lastLogin: null,
    createdAt: '2026-04-08T09:00:00Z',
  },
  {
    id: 'user-dave',
    username: 'dave',
    displayName: 'Dave Singh',
    email: 'dave@example.com',
    roles: ['viewer'],
    permissions: ['config:read', 'traffic:read'],
    totpEnabled: false,
    forcePasswordChange: false,
    status: 'suspended',
    lastLogin: '2026-03-15T10:00:00Z',
    createdAt: '2026-02-01T08:00:00Z',
  },
]

const adminRules: PermissionRule[] = [
  { id: 'rule-admin-all', resource: 'routes', actions: ['view', 'create', 'update', 'delete', 'manage'], scope: 'all', effect: 'allow' },
  { id: 'rule-admin-all-svc', resource: 'services', actions: ['view', 'create', 'update', 'delete', 'manage'], scope: 'all', effect: 'allow' },
  { id: 'rule-admin-all-pol', resource: 'policies', actions: ['view', 'create', 'update', 'delete', 'manage'], scope: 'all', effect: 'allow' },
  { id: 'rule-admin-all-keys', resource: 'keys', actions: ['view', 'create', 'update', 'delete', 'manage'], scope: 'all', effect: 'allow' },
  { id: 'rule-admin-all-users', resource: 'users', actions: ['view', 'create', 'update', 'delete', 'manage'], scope: 'all', effect: 'allow' },
  { id: 'rule-admin-all-roles', resource: 'roles', actions: ['view', 'create', 'update', 'delete', 'manage'], scope: 'all', effect: 'allow' },
  { id: 'rule-admin-all-settings', resource: 'settings', actions: ['view', 'create', 'update', 'delete', 'manage'], scope: 'all', effect: 'allow' },
  { id: 'rule-admin-all-cluster', resource: 'cluster', actions: ['view', 'create', 'update', 'delete', 'manage'], scope: 'all', effect: 'allow' },
  { id: 'rule-admin-all-plugins', resource: 'plugins', actions: ['view', 'create', 'update', 'delete', 'manage'], scope: 'all', effect: 'allow' },
  { id: 'rule-admin-all-audit', resource: 'audit', actions: ['view', 'manage'], scope: 'all', effect: 'allow' },
  { id: 'rule-admin-all-traffic', resource: 'traffic', actions: ['view', 'manage'], scope: 'all', effect: 'allow' },
  { id: 'rule-admin-all-certs', resource: 'certificates', actions: ['view', 'create', 'update', 'delete', 'manage'], scope: 'all', effect: 'allow' },
]

const operatorRules: PermissionRule[] = [
  { id: 'rule-op-routes', resource: 'routes', actions: ['view', 'create', 'update', 'delete'], scope: 'all', effect: 'allow' },
  { id: 'rule-op-services', resource: 'services', actions: ['view', 'create', 'update', 'delete'], scope: 'all', effect: 'allow' },
  { id: 'rule-op-policies', resource: 'policies', actions: ['view', 'create', 'update', 'delete'], scope: 'all', effect: 'allow' },
  { id: 'rule-op-keys', resource: 'keys', actions: ['view', 'create'], scope: 'owned', effect: 'allow' },
  { id: 'rule-op-traffic', resource: 'traffic', actions: ['view'], scope: 'all', effect: 'allow' },
  { id: 'rule-op-audit', resource: 'audit', actions: ['view'], scope: 'all', effect: 'allow' },
  { id: 'rule-op-certs', resource: 'certificates', actions: ['view'], scope: 'all', effect: 'allow' },
  { id: 'rule-op-plugins', resource: 'plugins', actions: ['view'], scope: 'all', effect: 'allow' },
]

const viewerRules: PermissionRule[] = [
  { id: 'rule-view-routes', resource: 'routes', actions: ['view'], scope: 'all', effect: 'allow' },
  { id: 'rule-view-services', resource: 'services', actions: ['view'], scope: 'all', effect: 'allow' },
  { id: 'rule-view-policies', resource: 'policies', actions: ['view'], scope: 'all', effect: 'allow' },
  { id: 'rule-view-traffic', resource: 'traffic', actions: ['view'], scope: 'all', effect: 'allow' },
  { id: 'rule-view-audit', resource: 'audit', actions: ['view'], scope: 'all', effect: 'allow' },
  { id: 'rule-view-certs', resource: 'certificates', actions: ['view'], scope: 'all', effect: 'allow' },
]

export const mockExpandedRoles: ExpandedRole[] = [
  {
    ...mockRoles[0],
    parentRoleIds: [],
    childRoleIds: ['role-operator'],
    memberCount: 1,
    rules: adminRules,
  },
  {
    ...mockRoles[1],
    parentRoleIds: ['role-admin'],
    childRoleIds: ['role-viewer'],
    memberCount: 2,
    rules: operatorRules,
  },
  {
    ...mockRoles[2],
    parentRoleIds: ['role-operator'],
    childRoleIds: [],
    memberCount: 2,
    rules: viewerRules,
  },
]

export const mockSession: SessionInfo = {
  id: 'sess-mock-001',
  createdAt: '2026-04-11T08:30:00Z',
  lastActive: '2026-04-11T10:00:00Z',
  expiresAt: '2026-04-11T20:30:00Z',
  ipAddress: '127.0.0.1',
  userAgent: 'MockBrowser/1.0',
}

export const mockMe: MeResponse = {
  session: mockSession,
  user: mockUsers[0],
}
