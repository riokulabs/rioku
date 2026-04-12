import { useState, useMemo } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  UserPlus, Shield, Users, X, Save, ChevronRight, ChevronDown, ArrowLeft,
  KeyRound, RotateCcw, Monitor, Trash2, Plus, ArrowRight,
  GitBranch, Eye, PenLine, ShieldAlert, Clock, Globe, Tag, Lock, Layers,
  GripVertical,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PermissionRule, ExpandedRole, AccessPolicy } from '@/lib/api'
import { mockUsers, mockExpandedRoles, mockRoles } from '@/mocks/data/users'
import { mockAccessPolicies } from '@/mocks/data/access-policies'
import { PageHeader } from '@/components/rioku/page-header'
import { DataTable } from '@/components/rioku/data-table'
import { EmptyState } from '@/components/rioku/empty-state'
import { TimeAgo } from '@/components/rioku/time-ago'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { SearchableSelect, SearchableMultiSelect } from '@rioku/ui'
import { useHasPermission } from '@/hooks/use-auth'

// ─── Extended mock data (matches mockup richness) ───

interface MockUser {
  id: string
  username: string
  firstName: string
  lastName: string
  email: string
  title?: string
  department?: string
  phone?: string
  timezone?: string
  locale?: string
  ssoProvider?: string
  ssoSubject?: string
  roles: string[]
  status: 'active' | 'locked' | 'disabled'
  mfa: 'enabled' | 'disabled'
  mfaType?: 'totp' | 'webauthn' | 'sms'
  lastLogin: string
  created: string
  lastModified: string
  sessions: { id: string; device: string; ip: string; lastActive: string; location?: string }[]
}

interface MockRole {
  id: string
  name: string
  description: string
  inherits: string[]
  builtIn: boolean
  color: 'info' | 'purple' | 'success' | 'warning' | 'muted'
  memberCount: number
  rules: PermissionRule[]
}

interface MockAccessPolicy {
  id: string
  name: string
  description: string
  enabled: boolean
  priority: number
  conditions: { type: string; value: string }[]
  effect: 'allow' | 'deny'
  target: { roles?: string[]; users?: string[] }
  permissions: { resource: string; actions: string[] }[]
}

const initialUsers: MockUser[] = [
  { id: 'u1', username: 'admin', firstName: 'Derrick', lastName: 'Mehaffy', email: 'admin@rioku.io', title: 'Platform Lead', department: 'Engineering', phone: '+1 (555) 100-0001', timezone: 'America/Los_Angeles', locale: 'en-US', roles: ['admin'], status: 'active', mfa: 'enabled', mfaType: 'totp', lastLogin: '2 minutes ago', created: '2026-01-15', lastModified: '2026-04-09', sessions: [
    { id: 's1', device: 'Chrome on macOS', ip: '10.0.1.5', lastActive: '2 min ago', location: 'San Francisco, CA' },
    { id: 's2', device: 'CLI (rioku v0.3.1)', ip: '10.0.1.5', lastActive: '1 hour ago', location: 'San Francisco, CA' },
  ]},
  { id: 'u2', username: 'jdoe', firstName: 'Jane', lastName: 'Doe', email: 'jdoe@company.com', title: 'SRE', department: 'Infrastructure', phone: '+1 (555) 100-0002', timezone: 'America/New_York', locale: 'en-US', ssoProvider: 'okta', ssoSubject: '00u1a2b3c4d5e6f7g8', roles: ['operator'], status: 'active', mfa: 'enabled', mfaType: 'webauthn', lastLogin: '1 hour ago', created: '2026-02-01', lastModified: '2026-04-08', sessions: [
    { id: 's3', device: 'Firefox on Linux', ip: '10.0.2.12', lastActive: '1 hour ago', location: 'New York, NY' },
  ]},
  { id: 'u3', username: 'schen', firstName: 'Sam', lastName: 'Chen', email: 'schen@company.com', title: 'Senior Backend Engineer', department: 'Engineering', timezone: 'America/Chicago', locale: 'en-US', ssoProvider: 'okta', ssoSubject: '00u2b3c4d5e6f7g8h9', roles: ['developer', 'operator'], status: 'active', mfa: 'enabled', mfaType: 'totp', lastLogin: '3 hours ago', created: '2026-02-14', lastModified: '2026-04-07', sessions: [] },
  { id: 'u4', username: 'mgarcia', firstName: 'Maria', lastName: 'Garcia', email: 'mgarcia@company.com', title: 'API Developer', department: 'Product', timezone: 'Europe/Madrid', locale: 'es-ES', ssoProvider: 'azure-ad', ssoSubject: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', roles: ['developer'], status: 'active', mfa: 'disabled', lastLogin: 'Yesterday', created: '2026-03-01', lastModified: '2026-03-28', sessions: [] },
  { id: 'u5', username: 'akim', firstName: 'Alex', lastName: 'Kim', email: 'akim@company.com', title: 'Junior Developer', department: 'Engineering', timezone: 'Asia/Seoul', locale: 'ko-KR', roles: ['viewer'], status: 'locked', mfa: 'disabled', lastLogin: '14 days ago', created: '2026-03-10', lastModified: '2026-03-27', sessions: [] },
  { id: 'u6', username: 'bot-ci', firstName: 'CI', lastName: 'Bot', email: 'ci@rioku.io', title: 'Service Account', department: 'Automation', timezone: 'UTC', locale: 'en-US', roles: ['operator'], status: 'active', mfa: 'enabled', mfaType: 'totp', lastLogin: '5 minutes ago', created: '2026-01-20', lastModified: '2026-04-09', sessions: [
    { id: 's5', device: 'CLI (rioku v0.3.1)', ip: '10.0.1.100', lastActive: '5 min ago', location: 'AWS us-east-1' },
  ]},
]

const initialRoles: MockRole[] = [
  {
    id: 'viewer', name: 'Viewer', description: 'Read-only access to configuration and traffic.', inherits: [],
    builtIn: true, color: 'muted', memberCount: 1,
    rules: [
      { id: 'r16', resource: 'routes', actions: ['view'], scope: 'all', effect: 'allow' },
      { id: 'r17', resource: 'services', actions: ['view'], scope: 'all', effect: 'allow' },
      { id: 'r18', resource: 'policies', actions: ['view'], scope: 'all', effect: 'allow' },
      { id: 'r19', resource: 'traffic', actions: ['view'], scope: 'all', effect: 'allow' },
      { id: 'r20', resource: 'cluster', actions: ['view'], scope: 'all', effect: 'allow' },
      { id: 'r21', resource: 'plugins', actions: ['view'], scope: 'all', effect: 'allow' },
    ],
  },
  {
    id: 'developer', name: 'Developer', description: 'Manage own routes and services, view traffic.', inherits: ['viewer'],
    builtIn: true, color: 'success', memberCount: 2,
    rules: [
      { id: 'r11', resource: 'routes', actions: ['view', 'create', 'update'], scope: 'labeled', scopeValue: 'team=${user.team}', effect: 'allow' },
      { id: 'r12', resource: 'services', actions: ['view', 'create', 'update'], scope: 'labeled', scopeValue: 'team=${user.team}', effect: 'allow' },
      { id: 'r13', resource: 'policies', actions: ['view'], scope: 'all', effect: 'allow' },
      { id: 'r14', resource: 'traffic', actions: ['view'], scope: 'labeled', scopeValue: 'team=${user.team}', effect: 'allow' },
      { id: 'r15', resource: 'keys', actions: ['view', 'create'], scope: 'owned', effect: 'allow' },
    ],
  },
  {
    id: 'operator', name: 'Operator', description: 'Manage all configuration and monitor traffic.', inherits: ['developer'],
    builtIn: true, color: 'purple', memberCount: 2,
    rules: [
      { id: 'r2', resource: 'routes', actions: ['view', 'create', 'update'], scope: 'all', effect: 'allow' },
      { id: 'r3', resource: 'services', actions: ['view', 'create', 'update'], scope: 'all', effect: 'allow' },
      { id: 'r4', resource: 'policies', actions: ['view', 'create', 'update'], scope: 'all', effect: 'allow' },
      { id: 'r5', resource: 'traffic', actions: ['view'], scope: 'all', effect: 'allow' },
      { id: 'r6', resource: 'settings', actions: ['view', 'update'], scope: 'all', effect: 'allow' },
      { id: 'r7', resource: 'cluster', actions: ['view'], scope: 'all', effect: 'allow' },
      { id: 'r8', resource: 'plugins', actions: ['view', 'update'], scope: 'all', effect: 'allow' },
      { id: 'r9', resource: 'keys', actions: ['view', 'create', 'update', 'delete'], scope: 'all', effect: 'allow' },
      { id: 'r10', resource: 'audit', actions: ['view'], scope: 'all', effect: 'allow' },
    ],
  },
  {
    id: 'admin', name: 'Admin', description: 'Full system access. Cannot be modified.', inherits: ['operator'],
    builtIn: true, color: 'info', memberCount: 1,
    rules: [{ id: 'r1', resource: '*', actions: ['*'], scope: 'all', effect: 'allow' }],
  },
  {
    id: 'support-agent', name: 'Support Agent', description: 'View traffic and routes scoped to customer labels.', inherits: ['viewer', 'developer'],
    builtIn: false, color: 'warning', memberCount: 0,
    rules: [
      { id: 'r22', resource: 'routes', actions: ['view'], scope: 'labeled', scopeValue: 'visibility=public', effect: 'allow' },
      { id: 'r23', resource: 'traffic', actions: ['view'], scope: 'all', effect: 'allow' },
      { id: 'r24', resource: 'audit', actions: ['view'], scope: 'all', effect: 'allow' },
    ],
  },
]

const initialPolicies: MockAccessPolicy[] = [
  {
    id: 'ap1', name: 'Restrict prod changes to business hours', description: 'Deny config mutations outside 08:00-18:00 UTC on weekdays',
    enabled: true, priority: 10,
    conditions: [{ type: 'time', value: 'outside 08:00-18:00 UTC weekdays' }],
    effect: 'deny',
    target: { roles: ['operator', 'developer'] },
    permissions: [{ resource: 'routes', actions: ['create', 'update', 'delete'] }, { resource: 'services', actions: ['create', 'update', 'delete'] }],
  },
  {
    id: 'ap2', name: 'Require MFA for destructive actions', description: 'Deny delete operations unless MFA session is active',
    enabled: true, priority: 20,
    conditions: [{ type: 'mfa', value: 'session not MFA-verified' }],
    effect: 'deny',
    target: { roles: ['operator', 'developer', 'admin'] },
    permissions: [{ resource: '*', actions: ['delete'] }],
  },
  {
    id: 'ap3', name: 'IP allowlist for settings', description: 'Only allow settings changes from office network',
    enabled: false, priority: 30,
    conditions: [{ type: 'ip', value: 'not in 10.0.0.0/8' }],
    effect: 'deny',
    target: {},
    permissions: [{ resource: 'settings', actions: ['update'] }],
  },
]

// ─── Color helpers ───

const roleColorClasses: Record<string, string> = {
  info: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
  purple: 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20',
  success: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20',
  warning: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20',
  muted: 'bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-500/20',
  error: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20',
}

const roleColorDots: Record<string, string> = {
  info: 'bg-blue-500',
  purple: 'bg-purple-500',
  success: 'bg-green-500',
  warning: 'bg-yellow-500',
  muted: 'bg-gray-400',
  error: 'bg-red-500',
}

function ColorBadge({ label, color, dot }: { label: string; color: string; dot?: boolean }) {
  return (
    <Badge variant="outline" className={cn('gap-1.5 border-transparent', roleColorClasses[color] ?? roleColorClasses.muted)}>
      {dot && <span className={cn('size-1.5 rounded-full', roleColorDots[color] ?? roleColorDots.muted)} aria-hidden="true" />}
      {label}
    </Badge>
  )
}

function RoleBadge({ role }: { role: MockRole }) {
  return <ColorBadge label={role.name} color={role.color} dot />
}

// ─── Helpers ───

const resourceIcons: Record<string, typeof Shield> = {
  routes: ArrowRight, services: Layers, policies: Shield, traffic: Eye, settings: PenLine,
  cluster: Globe, plugins: Layers, keys: KeyRound, audit: Clock, users: Users, '*': ShieldAlert,
}

const scopeLabels: Record<string, string> = {
  all: 'All resources', owned: 'Owned only', labeled: 'By label', specific: 'Specific IDs',
}

const allResources = ['routes', 'services', 'policies', 'traffic', 'settings', 'cluster', 'plugins', 'keys', 'audit', 'users']
const allActions = ['view', 'create', 'update', 'delete', 'manage']
const conditionTypes = ['time', 'ip', 'mfa', 'geo', 'device', 'custom'] as const

// ─── Route definition ───

export const Route = createFileRoute('/security/users/')({
  component: UsersSecurityPage,
})

// ─── Role Hierarchy Tree ───

function RoleHierarchyTree({ roles, selectedId, onSelect }: { roles: MockRole[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const rootRoles = roles.filter(r => r.inherits.length === 0)
  const childrenOf = (parentId: string) => roles.filter(r => r.inherits.includes(parentId))

  const rendered = new Set<string>()
  const items: { role: MockRole; depth: number }[] = []
  function visit(role: MockRole, depth: number) {
    if (rendered.has(role.id)) return
    rendered.add(role.id)
    items.push({ role, depth })
    childrenOf(role.id).forEach(c => visit(c, depth + 1))
  }
  rootRoles.forEach(r => visit(r, 0))
  roles.forEach(r => { if (!rendered.has(r.id)) items.push({ role: r, depth: 1 }) })

  return (
    <div className="space-y-1">
      {items.map(({ role, depth }) => {
        const isSelected = selectedId === role.id
        const children = childrenOf(role.id)
        const parents = roles.filter(r => role.inherits.includes(r.id))
        const cappedMargin = Math.min(depth * 20, 60)

        return (
          <div key={role.id} style={{ marginLeft: cappedMargin }}>
            <button
              onClick={() => onSelect(role.id)}
              className={cn(
                'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-colors',
                isSelected ? 'bg-accent border border-primary/30' : 'hover:bg-secondary/50 border border-transparent',
              )}
            >
              <GripVertical size={14} className="text-muted-foreground/30 shrink-0" />
              {children.length > 0 ? <GitBranch size={14} className="text-muted-foreground shrink-0" /> : <div className="w-3.5 shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <RoleBadge role={role} />
                  {role.builtIn && <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">built-in</span>}
                  {parents.length > 1 && <span className="text-[10px] text-primary/70 bg-primary/10 px-1.5 py-0.5 rounded">multi-inherit</span>}
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{role.description}</p>
                {parents.length > 0 && (
                  <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                    <span className="text-[10px] text-muted-foreground">inherits:</span>
                    {parents.map(p => <span key={p.id} className="text-[10px] text-foreground/70 bg-muted px-1.5 py-0.5 rounded">{p.name}</span>)}
                  </div>
                )}
              </div>
              <ChevronRight size={14} className="text-muted-foreground shrink-0" />
            </button>
          </div>
        )
      })}
    </div>
  )
}

// ─── Role Detail ───

function RoleDetail({ role, roles, onUpdate, onNavigateToUser }: { role: MockRole; roles: MockRole[]; onUpdate: (role: MockRole) => void; onNavigateToUser: (user: MockUser) => void }) {
  const parents = roles.filter(r => role.inherits.includes(r.id))
  const children = roles.filter(r => r.inherits.includes(role.id))
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(role.name)
  const [editDesc, setEditDesc] = useState(role.description)
  const [editInherits, setEditInherits] = useState<string[]>(role.inherits)
  const [showAddRule, setShowAddRule] = useState(false)
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null)
  const [editingRule, setEditingRule] = useState<PermissionRule | null>(null)
  const [showAssignUser, setShowAssignUser] = useState(false)
  const [newRule, setNewRule] = useState<{ resource: string; actions: string[]; scope: 'all' | 'owned' | 'labeled' | 'specific'; scopeValue: string; effect: 'allow' | 'deny' }>({ resource: 'routes', actions: ['view'], scope: 'all', scopeValue: '', effect: 'allow' })

  const roleMembers = initialUsers.filter(u => u.roles.includes(role.id))

  const handleDeleteRule = (ruleId: string) => {
    onUpdate({ ...role, rules: role.rules.filter(r => r.id !== ruleId) })
    toast.success('Rule deleted')
  }

  const handleStartEditRule = (rule: PermissionRule) => {
    setEditingRuleId(rule.id)
    setEditingRule({ ...rule })
  }

  const handleSaveEditRule = () => {
    if (!editingRule) return
    onUpdate({ ...role, rules: role.rules.map(r => r.id === editingRule.id ? editingRule : r) })
    setEditingRuleId(null)
    setEditingRule(null)
    toast.success('Rule updated')
  }

  const handleCancelEditRule = () => {
    setEditingRuleId(null)
    setEditingRule(null)
  }

  const handleAssignUser = (_userId: string) => {
    toast.success(`User assigned to ${role.name}`)
    setShowAssignUser(false)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          {editing ? (
            <div className="space-y-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1">Role Name</Label>
                <Input type="text" value={editName} onChange={e => setEditName(e.target.value)} className="w-64 font-semibold" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1">Description</Label>
                <Input type="text" value={editDesc} onChange={e => setEditDesc(e.target.value)} className="w-full" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1">Inherits from (multi-select)</Label>
                <SearchableMultiSelect
                  options={roles.filter(r => r.id !== role.id).map(r => ({ value: r.id, label: r.name, description: r.description }))}
                  value={editInherits}
                  onChange={setEditInherits}
                  placeholder="Add parent..."
                />
                <p className="text-[11px] text-muted-foreground mt-1">Permissions are the union of all parent roles. Deny rules take precedence.</p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <h3 className="text-lg font-semibold text-foreground">{role.name}</h3>
                <RoleBadge role={role} />
                {role.builtIn && <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">built-in</span>}
              </div>
              <p className="text-sm text-muted-foreground mt-1">{role.description}</p>
            </>
          )}
        </div>
        <div className="flex gap-2">
          {editing ? (
            <>
              <Button size="sm" onClick={() => { onUpdate({ ...role, name: editName, description: editDesc, inherits: editInherits }); setEditing(false); toast.success('Role updated') }}><Save size={12} /> Save</Button>
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
            </>
          ) : !role.builtIn ? (
            <>
              <Button variant="secondary" size="sm" onClick={() => { setEditName(role.name); setEditDesc(role.description); setEditInherits([...role.inherits]); setEditing(true) }}><PenLine size={12} /> Edit</Button>
              <Button variant="destructive" size="sm" onClick={() => toast.error('Cannot delete role with members')}>Delete</Button>
            </>
          ) : role.id !== 'admin' ? (
            <Button variant="secondary" size="sm" onClick={() => { setEditName(role.name); setEditDesc(role.description); setEditInherits([...role.inherits]); setEditing(true) }}><PenLine size={12} /> Edit rules</Button>
          ) : null}
        </div>
      </div>

      {/* Hierarchy info */}
      {(parents.length > 0 || children.length > 0) && (
        <Card>
          <CardContent className="p-4">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Hierarchy</h4>
            <div className="space-y-2">
              {parents.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-muted-foreground">Inherits from</span>
                  {parents.map(p => <RoleBadge key={p.id} role={p} />)}
                  {parents.length > 1 && <span className="text-[10px] text-primary/70 bg-primary/10 px-1.5 py-0.5 rounded">multi-inherit</span>}
                </div>
              )}
              {children.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-muted-foreground">Parent of</span>
                  {children.map(c => <RoleBadge key={c.id} role={c} />)}
                </div>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground/70 mt-2">Child roles inherit all permission rules from their parents. With multiple parents, effective permissions are the union. Explicit deny rules always take precedence over allow.</p>
          </CardContent>
        </Card>
      )}

      {/* Permission rules */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Permission Rules ({role.rules.length})</h4>
          <button onClick={() => setShowAddRule(!showAddRule)} className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 font-medium transition-colors">
            <Plus size={12} /> Add rule
          </button>
        </div>

        {/* Add rule form */}
        {showAddRule && (
          <div className="rounded-xl border border-primary/30 bg-accent/30 p-4 mb-3 space-y-3">
            <h5 className="text-xs font-semibold text-foreground">New Permission Rule</h5>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <Label className="text-[11px] text-muted-foreground mb-1">Effect</Label>
                <select value={newRule.effect} onChange={e => setNewRule({ ...newRule, effect: e.target.value as 'allow' | 'deny' })} className="h-9 w-full rounded-lg bg-background border border-border px-3 text-xs text-foreground outline-none">
                  <option value="allow">Allow</option>
                  <option value="deny">Deny</option>
                </select>
              </div>
              <div>
                <Label className="text-[11px] text-muted-foreground mb-1">Resource</Label>
                <select value={newRule.resource} onChange={e => setNewRule({ ...newRule, resource: e.target.value })} className="h-9 w-full rounded-lg bg-background border border-border px-3 text-xs text-foreground outline-none">
                  <option value="*">All resources</option>
                  {allResources.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-[11px] text-muted-foreground mb-1">Scope</Label>
                <select value={newRule.scope} onChange={e => setNewRule({ ...newRule, scope: e.target.value as 'all' | 'owned' | 'labeled' | 'specific' })} className="h-9 w-full rounded-lg bg-background border border-border px-3 text-xs text-foreground outline-none">
                  <option value="all">All resources</option>
                  <option value="owned">Owned only</option>
                  <option value="labeled">By label</option>
                  <option value="specific">Specific IDs</option>
                </select>
              </div>
              {(newRule.scope === 'labeled' || newRule.scope === 'specific') && (
                <div>
                  <Label className="text-[11px] text-muted-foreground mb-1">{newRule.scope === 'labeled' ? 'Label selector' : 'Resource IDs'}</Label>
                  <Input type="text" value={newRule.scopeValue} onChange={e => setNewRule({ ...newRule, scopeValue: e.target.value })} placeholder={newRule.scope === 'labeled' ? 'team=frontend' : 'route-id-1, route-id-2'} className="h-9 text-xs" />
                </div>
              )}
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground mb-1">Actions</Label>
              <div className="flex flex-wrap gap-2">
                {allActions.map(a => (
                  <label key={a} className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" checked={newRule.actions.includes(a)} onChange={e => {
                      setNewRule({ ...newRule, actions: e.target.checked ? [...newRule.actions, a] : newRule.actions.filter(x => x !== a) })
                    }} className="w-3.5 h-3.5 rounded border-border accent-primary" />
                    <span className="text-xs text-foreground">{a}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={() => {
                const id = `r${Date.now()}`
                const rule: PermissionRule = { id, resource: newRule.resource, actions: newRule.actions, scope: newRule.scope, scopeValue: newRule.scopeValue || undefined, effect: newRule.effect }
                onUpdate({ ...role, rules: [...role.rules, rule] })
                setShowAddRule(false)
                setNewRule({ resource: 'routes', actions: ['view'], scope: 'all', scopeValue: '', effect: 'allow' })
                toast.success('Rule added')
              }}><Plus size={12} /> Add</Button>
              <Button variant="ghost" size="sm" onClick={() => setShowAddRule(false)}>Cancel</Button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {role.rules.map(rule => {
            const Icon = resourceIcons[rule.resource] ?? Shield
            const isEditingThis = editingRuleId === rule.id

            if (isEditingThis && editingRule) {
              return (
                <div key={rule.id} className="rounded-xl border border-primary/30 bg-accent/30 p-4 space-y-3">
                  <h5 className="text-xs font-semibold text-foreground">Edit Permission Rule</h5>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div>
                      <Label className="text-[11px] text-muted-foreground mb-1">Effect</Label>
                      <select value={editingRule.effect} onChange={e => setEditingRule({ ...editingRule, effect: e.target.value as 'allow' | 'deny' })} className="h-9 w-full rounded-lg bg-background border border-border px-3 text-xs text-foreground outline-none">
                        <option value="allow">Allow</option>
                        <option value="deny">Deny</option>
                      </select>
                    </div>
                    <div>
                      <Label className="text-[11px] text-muted-foreground mb-1">Resource</Label>
                      <select value={editingRule.resource} onChange={e => setEditingRule({ ...editingRule, resource: e.target.value })} className="h-9 w-full rounded-lg bg-background border border-border px-3 text-xs text-foreground outline-none">
                        <option value="*">All resources</option>
                        {allResources.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                    <div>
                      <Label className="text-[11px] text-muted-foreground mb-1">Scope</Label>
                      <select value={editingRule.scope} onChange={e => setEditingRule({ ...editingRule, scope: e.target.value as 'all' | 'owned' | 'labeled' | 'specific' })} className="h-9 w-full rounded-lg bg-background border border-border px-3 text-xs text-foreground outline-none">
                        <option value="all">All resources</option>
                        <option value="owned">Owned only</option>
                        <option value="labeled">By label</option>
                        <option value="specific">Specific IDs</option>
                      </select>
                    </div>
                    {(editingRule.scope === 'labeled' || editingRule.scope === 'specific') && (
                      <div>
                        <Label className="text-[11px] text-muted-foreground mb-1">{editingRule.scope === 'labeled' ? 'Label selector' : 'Resource IDs'}</Label>
                        <Input type="text" value={editingRule.scopeValue ?? ''} onChange={e => setEditingRule({ ...editingRule, scopeValue: e.target.value })} className="h-9 text-xs" />
                      </div>
                    )}
                  </div>
                  <div>
                    <Label className="text-[11px] text-muted-foreground mb-1">Actions</Label>
                    <div className="flex flex-wrap gap-2">
                      {allActions.map(a => (
                        <label key={a} className="inline-flex items-center gap-1.5 cursor-pointer">
                          <input type="checkbox" checked={editingRule.actions.includes(a)} onChange={e => {
                            setEditingRule({ ...editingRule, actions: e.target.checked ? [...editingRule.actions, a] : editingRule.actions.filter(x => x !== a) })
                          }} className="w-3.5 h-3.5 rounded border-border accent-primary" />
                          <span className="text-xs text-foreground">{a}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" onClick={handleSaveEditRule}><Save size={12} /> Save</Button>
                    <Button variant="ghost" size="sm" onClick={handleCancelEditRule}>Cancel</Button>
                  </div>
                </div>
              )
            }

            return (
              <div key={rule.id} className="rounded-xl border border-border bg-card p-4 flex items-start gap-4 group">
                <div className={cn(
                  'w-9 h-9 rounded-lg flex items-center justify-center shrink-0',
                  rule.effect === 'allow' ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-red-500/10 text-red-600 dark:text-red-400'
                )}>
                  <Icon size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <ColorBadge
                      label={rule.effect.toUpperCase()}
                      color={rule.effect === 'allow' ? 'success' : 'error'}
                    />
                    <span className="text-sm font-medium text-foreground">
                      {rule.actions.includes('*') ? 'All actions' : rule.actions.join(', ')}
                    </span>
                    <span className="text-sm text-muted-foreground">on</span>
                    <span className="text-sm font-medium text-foreground font-mono">
                      {rule.resource === '*' ? 'all resources' : rule.resource}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <Tag size={12} className="text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      Scope: {scopeLabels[rule.scope]}
                      {rule.scopeValue && <span className="font-mono ml-1 text-foreground/70">{rule.scopeValue}</span>}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => handleStartEditRule(rule)} className="text-muted-foreground hover:text-foreground p-1 rounded transition-colors" title="Edit rule">
                    <PenLine size={14} />
                  </button>
                  <button onClick={() => handleDeleteRule(rule.id)} className="text-muted-foreground hover:text-destructive p-1 rounded transition-colors" title="Delete rule">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Members */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Members ({roleMembers.length})</h4>
          <div className="relative">
            <button onClick={() => setShowAssignUser(!showAssignUser)} className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 font-medium transition-colors">
              <UserPlus size={12} /> Assign user
            </button>
            {showAssignUser && (
              <div className="absolute right-0 top-full mt-1 z-20 w-56 rounded-lg border border-border bg-card shadow-lg p-1">
                {initialUsers.filter(u => !u.roles.includes(role.id)).length === 0 ? (
                  <p className="text-xs text-muted-foreground px-3 py-2">All users are already assigned</p>
                ) : (
                  initialUsers.filter(u => !u.roles.includes(role.id)).map(u => (
                    <button
                      key={u.id}
                      onClick={() => handleAssignUser(u.id)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-left hover:bg-accent transition-colors"
                    >
                      <div className="w-6 h-6 rounded-full bg-primary/15 flex items-center justify-center text-primary text-[10px] font-bold shrink-0">{u.username.charAt(0).toUpperCase()}</div>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{u.firstName} {u.lastName}</p>
                        <p className="text-[10px] text-muted-foreground truncate">@{u.username}</p>
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
        {roleMembers.length === 0 ? (
          <p className="text-xs text-muted-foreground">No users assigned to this role.</p>
        ) : (
          <div className="space-y-1.5">
            {roleMembers.map(user => (
              <button
                key={user.id}
                onClick={() => onNavigateToUser(user)}
                className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg hover:bg-accent/50 text-left transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center text-primary text-xs font-bold shrink-0">{user.username.charAt(0).toUpperCase()}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{user.firstName} {user.lastName}</p>
                  <p className="text-xs text-muted-foreground">@{user.username} &middot; {user.email}</p>
                </div>
                <ChevronRight size={14} className="text-muted-foreground shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Effective Permissions Panel ───

function EffectivePermissionsPanel({ userRoles, allRoles, policies }: { userRoles: string[]; allRoles: MockRole[]; policies: MockAccessPolicy[] }) {
  const [expanded, setExpanded] = useState(false)

  const allRulesByResource: Record<string, { actions: Set<string>; denied: Set<string>; scopes: string[] }> = {}
  const collectRules = (roleId: string, visited: Set<string>) => {
    if (visited.has(roleId)) return
    visited.add(roleId)
    const role = allRoles.find(r => r.id === roleId)
    if (!role) return
    role.inherits.forEach(pid => collectRules(pid, visited))
    role.rules.forEach(rule => {
      const resources = rule.resource === '*' ? ['routes', 'services', 'policies', 'traffic', 'settings', 'cluster', 'plugins', 'keys', 'audit', 'users'] : [rule.resource]
      const actions = rule.actions.includes('*') ? ['view', 'create', 'update', 'delete', 'manage'] : rule.actions
      resources.forEach(res => {
        if (!allRulesByResource[res]) allRulesByResource[res] = { actions: new Set(), denied: new Set(), scopes: [] }
        actions.forEach(a => { if (rule.effect === 'allow') allRulesByResource[res].actions.add(a); else allRulesByResource[res].denied.add(a) })
        if (rule.scope !== 'all') allRulesByResource[res].scopes.push(`${rule.scope}${rule.scopeValue ? `: ${rule.scopeValue}` : ''}`)
      })
    })
  }
  userRoles.forEach(rid => collectRules(rid, new Set()))

  const applicablePolicies = policies.filter(p => p.enabled && (!p.target.roles || p.target.roles.length === 0 || p.target.roles.some(r => userRoles.includes(r))))
  applicablePolicies.forEach(policy => {
    if (policy.effect === 'deny') {
      policy.permissions.forEach(perm => {
        const resources = perm.resource === '*' ? Object.keys(allRulesByResource) : [perm.resource]
        resources.forEach(res => { if (allRulesByResource[res]) perm.actions.forEach(a => allRulesByResource[res].denied.add(a)) })
      })
    }
  })

  const resourceOrder = ['routes', 'services', 'policies', 'traffic', 'keys', 'settings', 'cluster', 'plugins', 'audit', 'users']
  const sortedResources = Object.keys(allRulesByResource).sort((a, b) => resourceOrder.indexOf(a) - resourceOrder.indexOf(b))
  const permActions = ['view', 'create', 'update', 'delete', 'manage']

  const totalAllowed = sortedResources.reduce((sum, res) => sum + allRulesByResource[res].actions.size, 0)
  const totalDenied = sortedResources.reduce((sum, res) => sum + allRulesByResource[res].denied.size, 0)
  const totalScoped = sortedResources.filter(res => allRulesByResource[res].scopes.length > 0).length

  return (
    <Card className="overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-6 py-4 text-left hover:bg-secondary/30 transition-colors"
      >
        {expanded ? <ChevronDown size={16} className="text-muted-foreground" /> : <ChevronRight size={16} className="text-muted-foreground" />}
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-foreground">Effective Permissions</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {totalAllowed} allowed &middot; {totalDenied} denied &middot; {totalScoped} scoped &middot; {applicablePolicies.length} access {applicablePolicies.length === 1 ? 'policy' : 'policies'} applied
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-500/15 text-green-600 dark:text-green-400">{totalAllowed} allow</span>
          {totalDenied > 0 && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-500/15 text-red-600 dark:text-red-400">{totalDenied} deny</span>}
        </div>
      </button>

      {expanded && (
        <div className="px-6 pb-6 pt-2 border-t border-border/50">
          <p className="text-xs text-muted-foreground mb-4">Resolved permission set from role inheritance and access policy overrides.</p>

          <div className="space-y-1.5">
            <div className="grid grid-cols-[160px_repeat(5,1fr)] gap-1 px-3 py-2">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase">Resource</span>
              {permActions.map(a => <span key={a} className="text-[10px] font-semibold text-muted-foreground uppercase text-center">{a}</span>)}
            </div>
            {sortedResources.map(res => {
              const { actions, denied, scopes } = allRulesByResource[res]
              const Icon = resourceIcons[res] ?? Shield
              return (
                <div key={res} className="grid grid-cols-[160px_repeat(5,1fr)] gap-1 px-3 py-2.5 rounded-lg bg-background border border-border/30 items-center">
                  <div className="flex items-center gap-2">
                    <Icon size={14} className="text-muted-foreground" />
                    <span className="text-xs font-medium text-foreground capitalize">{res}</span>
                    {scopes.length > 0 && (
                      <span className="text-[9px] text-yellow-700 dark:text-yellow-400 bg-yellow-500/10 px-1.5 py-0.5 rounded" title={scopes.join('\n')}>scoped</span>
                    )}
                  </div>
                  {permActions.map(action => {
                    const allowed = actions.has(action)
                    const isDenied = denied.has(action)
                    return (
                      <div key={action} className="flex flex-col items-center gap-0.5">
                        {isDenied ? (
                          <span className="w-6 h-6 rounded-full bg-red-500/15 flex items-center justify-center text-red-600 dark:text-red-400 text-[10px] font-bold" title="Denied by access policy">&times;</span>
                        ) : allowed ? (
                          <span className="w-6 h-6 rounded-full bg-green-500/15 flex items-center justify-center text-green-600 dark:text-green-400 text-[10px] font-bold">&#10003;</span>
                        ) : (
                          <span className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-muted-foreground/40 text-[10px]">&mdash;</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>

          {totalScoped > 0 && (
            <div className="mt-4 p-3 rounded-lg bg-yellow-500/5 border border-yellow-500/20">
              <p className="text-[11px] text-yellow-700 dark:text-yellow-400 font-medium mb-1">Scoped permissions ({totalScoped} resources)</p>
              {sortedResources.filter(res => allRulesByResource[res].scopes.length > 0).map(res => (
                <p key={res} className="text-[11px] text-muted-foreground">&bull; <span className="text-foreground/80 capitalize">{res}</span>: {allRulesByResource[res].scopes.join(', ')}</p>
              ))}
            </div>
          )}

          {applicablePolicies.length > 0 && (
            <div className="mt-3 p-3 rounded-lg bg-red-500/5 border border-red-500/20">
              <p className="text-[11px] text-red-600 dark:text-red-400 font-medium mb-1">Access policy overrides ({applicablePolicies.length})</p>
              {applicablePolicies.map(p => (
                <div key={p.id} className="text-[11px] text-muted-foreground mt-1">
                  <span className="text-foreground/80 font-medium">{p.name}</span>: {p.effect} &mdash; {p.permissions.map(pm => `${pm.resource} [${pm.actions.join(', ')}]`).join('; ')}
                  {p.conditions.length > 0 && <span className="text-muted-foreground/70 ml-1">(when: {p.conditions.map(c => `${c.type} ${c.value}`).join(', ')})</span>}
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 flex items-center gap-4 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-green-500/15 inline-flex items-center justify-center text-green-600 dark:text-green-400 text-[8px]">&#10003;</span> Allowed</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-500/15 inline-flex items-center justify-center text-red-600 dark:text-red-400 text-[8px]">&times;</span> Denied by policy</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-muted inline-block" /> Not granted</span>
            <span className="flex items-center gap-1"><span className="text-[9px] text-yellow-700 dark:text-yellow-400 bg-yellow-500/10 px-1 rounded">scoped</span> Conditional scope</span>
          </div>
        </div>
      )}
    </Card>
  )
}

// ─── Access Policies Tab ───

function AccessPoliciesTab({ policies: initialPols }: { policies: MockAccessPolicy[] }) {
  const [policies, setPolicies] = useState(initialPols)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<MockAccessPolicy | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [createDraft, setCreateDraft] = useState<MockAccessPolicy>(() => emptyPolicy())

  function emptyPolicy(): MockAccessPolicy {
    return { id: `ap-${Date.now()}`, name: '', description: '', enabled: true, priority: 50, conditions: [], effect: 'deny', target: {}, permissions: [] }
  }

  const startEdit = (p: MockAccessPolicy) => {
    setEditDraft({ ...p, conditions: p.conditions.map(c => ({ ...c })), permissions: p.permissions.map(pr => ({ ...pr, actions: [...pr.actions] })), target: { roles: [...(p.target.roles ?? [])], users: [...(p.target.users ?? [])] } })
    setEditingId(p.id)
    setExpanded(p.id)
  }
  const cancelEdit = () => { setEditingId(null); setEditDraft(null) }
  const saveEdit = () => { if (editDraft) { setPolicies(prev => prev.map(p => p.id === editDraft.id ? editDraft : p)); toast.success('Access policy updated'); cancelEdit() } }
  const deletePolicy = (id: string) => { setPolicies(prev => prev.filter(p => p.id !== id)); toast.success('Access policy deleted'); setExpanded(null) }
  const toggleEnabled = (id: string) => { setPolicies(prev => prev.map(p => p.id === id ? { ...p, enabled: !p.enabled } : p)); const p = policies.find(x => x.id === id); toast.info(`Policy ${p?.enabled ? 'disabled' : 'enabled'}`) }
  const saveCreate = () => { if (!createDraft.name.trim()) { toast.error('Policy name is required'); return } setPolicies(prev => [...prev, createDraft]); setShowCreate(false); setCreateDraft(emptyPolicy()); toast.success('Access policy created') }

  const renderPolicyForm = (draft: MockAccessPolicy, update: (d: MockAccessPolicy) => void) => (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5">Name</Label>
          <Input type="text" value={draft.name} onChange={e => update({ ...draft, name: e.target.value })} placeholder="e.g. Restrict prod changes" />
        </div>
        <div className="flex gap-4">
          <div className="flex-1">
            <Label className="text-xs text-muted-foreground mb-1.5">Effect</Label>
            <select value={draft.effect} onChange={e => update({ ...draft, effect: e.target.value as 'allow' | 'deny' })} className="h-10 w-full rounded-lg bg-background border border-border px-3.5 text-sm text-foreground outline-none">
              <option value="deny">Deny</option><option value="allow">Allow</option>
            </select>
          </div>
          <div className="w-24">
            <Label className="text-xs text-muted-foreground mb-1.5">Priority</Label>
            <Input type="number" value={draft.priority} onChange={e => update({ ...draft, priority: Number(e.target.value) })} className="tabular-nums" />
          </div>
        </div>
      </div>
      <div>
        <Label className="text-xs text-muted-foreground mb-1.5">Description</Label>
        <Input type="text" value={draft.description} onChange={e => update({ ...draft, description: e.target.value })} placeholder="Describe what this policy does" />
      </div>

      {/* Conditions */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <Label className="text-xs text-muted-foreground">Conditions (all must match)</Label>
          <button onClick={() => update({ ...draft, conditions: [...draft.conditions, { type: 'time', value: '' }] })} className="text-xs text-primary hover:text-primary/80 font-medium"><Plus size={12} className="inline" /> Add</button>
        </div>
        <div className="space-y-2">
          {draft.conditions.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <select value={c.type} onChange={e => { const next = [...draft.conditions]; next[i] = { ...next[i], type: e.target.value }; update({ ...draft, conditions: next }) }} className="h-9 w-28 rounded-lg bg-background border border-border px-2 text-xs text-foreground outline-none">
                {conditionTypes.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <Input type="text" value={c.value} onChange={e => { const next = [...draft.conditions]; next[i] = { ...next[i], value: e.target.value }; update({ ...draft, conditions: next }) }} placeholder="e.g. outside 08:00-18:00 UTC" className="h-9 flex-1 text-xs font-mono" />
              <button onClick={() => update({ ...draft, conditions: draft.conditions.filter((_, j) => j !== i) })} className="text-muted-foreground hover:text-destructive"><X size={14} /></button>
            </div>
          ))}
        </div>
      </div>

      {/* Target roles */}
      <div>
        <Label className="text-xs text-muted-foreground mb-1.5">Applies to roles</Label>
        <SearchableMultiSelect
          options={['admin', 'operator', 'developer', 'viewer'].map(r => ({ value: r, label: r }))}
          value={draft.target.roles ?? []}
          onChange={(selected) => update({ ...draft, target: { ...draft.target, roles: selected } })}
          placeholder="Add role..."
        />
        <p className="text-[11px] text-muted-foreground mt-1">Leave empty to apply to all roles</p>
      </div>

      {/* Permissions affected */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <Label className="text-xs text-muted-foreground">Permissions affected</Label>
          <button onClick={() => update({ ...draft, permissions: [...draft.permissions, { resource: 'routes', actions: ['create'] }] })} className="text-xs text-primary hover:text-primary/80 font-medium"><Plus size={12} className="inline" /> Add</button>
        </div>
        <div className="space-y-2">
          {draft.permissions.map((perm, i) => (
            <div key={i} className="flex items-center gap-2 flex-wrap">
              <select value={perm.resource} onChange={e => { const next = [...draft.permissions]; next[i] = { ...next[i], resource: e.target.value }; update({ ...draft, permissions: next }) }} className="h-9 w-32 rounded-lg bg-background border border-border px-2 text-xs text-foreground outline-none">
                {[...allResources, '*'].map(r => <option key={r} value={r}>{r === '*' ? 'all resources' : r}</option>)}
              </select>
              <div className="flex items-center gap-1.5 flex-wrap">
                {allActions.map(a => (
                  <label key={a} className="inline-flex items-center gap-1 cursor-pointer">
                    <input type="checkbox" checked={perm.actions.includes(a)} onChange={e => { const next = [...draft.permissions]; next[i] = { ...next[i], actions: e.target.checked ? [...perm.actions, a] : perm.actions.filter(x => x !== a) }; update({ ...draft, permissions: next }) }} className="w-3 h-3 rounded accent-primary" />
                    <span className="text-[11px] text-foreground">{a}</span>
                  </label>
                ))}
              </div>
              <button onClick={() => update({ ...draft, permissions: draft.permissions.filter((_, j) => j !== i) })} className="text-muted-foreground hover:text-destructive ml-auto"><X size={14} /></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <p className="text-sm text-muted-foreground">
          Conditional access policies add dynamic constraints on top of role-based permissions.
        </p>
        <Button onClick={() => { setShowCreate(true); setCreateDraft(emptyPolicy()) }}>
          <Plus size={16} /> Create policy
        </Button>
      </div>

      {/* Create form */}
      {showCreate && (
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-foreground">Create Access Policy</h3>
            <button onClick={() => setShowCreate(false)} className="p-1 rounded-md hover:bg-muted text-muted-foreground"><X size={16} /></button>
          </div>
          {renderPolicyForm(createDraft, setCreateDraft)}
          <div className="flex gap-3 pt-4 border-t border-border/50 mt-4">
            <Button onClick={saveCreate}><Plus size={14} /> Create</Button>
            <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
          </div>
        </Card>
      )}

      {/* Policy list */}
      <div className="space-y-3">
        {policies.map(policy => (
          <div key={policy.id} className={cn('rounded-xl border bg-card overflow-hidden transition-colors', policy.enabled ? 'border-border' : 'border-border/50 opacity-60')}>
            <button
              onClick={() => { if (editingId !== policy.id) setExpanded(expanded === policy.id ? null : policy.id) }}
              className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-secondary/30 transition-colors"
            >
              {expanded === policy.id ? <ChevronDown size={16} className="text-muted-foreground shrink-0" /> : <ChevronRight size={16} className="text-muted-foreground shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{policy.name}</span>
                  <ColorBadge label={policy.effect.toUpperCase()} color={policy.effect === 'deny' ? 'error' : 'success'} />
                  {!policy.enabled && <ColorBadge label="Disabled" color="muted" />}
                  {editingId === policy.id && <ColorBadge label="Editing" color="warning" />}
                  <span className="text-[10px] text-muted-foreground ml-auto">Priority {policy.priority}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{policy.description}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                <Switch
                  checked={policy.enabled}
                  onCheckedChange={() => toggleEnabled(policy.id)}
                  size="sm"
                />
              </div>
            </button>

            {expanded === policy.id && (
              <div className="px-5 pb-5 pt-2 border-t border-border/50 space-y-4">
                {editingId === policy.id && editDraft ? (
                  <>
                    {renderPolicyForm(editDraft, setEditDraft)}
                    <div className="flex gap-2 pt-2 border-t border-border/50">
                      <Button size="sm" onClick={saveEdit}><Save size={14} /> Save</Button>
                      <Button variant="ghost" size="sm" onClick={cancelEdit}>Cancel</Button>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <h5 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Conditions (all must match)</h5>
                      <div className="space-y-1.5">
                        {policy.conditions.map((c, i) => (
                          <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-background border border-border/50">
                            <ColorBadge label={c.type} color="info" />
                            <span className="text-xs font-mono text-foreground">{c.value}</span>
                          </div>
                        ))}
                        {policy.conditions.length === 0 && <p className="text-xs text-muted-foreground">No conditions -- always applies</p>}
                      </div>
                    </div>
                    <div>
                      <h5 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Applies to</h5>
                      <div className="flex items-center gap-2 flex-wrap">
                        {(policy.target.roles && policy.target.roles.length > 0) ? policy.target.roles.map(r => <ColorBadge key={r} label={r} color="purple" />) : <span className="text-xs text-muted-foreground">All roles</span>}
                      </div>
                    </div>
                    <div>
                      <h5 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Permissions affected</h5>
                      <div className="space-y-1.5">
                        {policy.permissions.map((p, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs">
                            <span className="font-mono text-foreground">{p.resource}</span>
                            <span className="text-muted-foreground">&rarr;</span>
                            <span className="text-foreground">{p.actions.join(', ')}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-2 pt-2 border-t border-border/50">
                      <Button variant="secondary" size="sm" onClick={() => startEdit(policy)}><PenLine size={12} /> Edit</Button>
                      <Button variant="destructive" size="sm" onClick={() => deletePolicy(policy.id)}><Trash2 size={12} /> Delete</Button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── User Detail View ───

function UserDetailView({ user, roles, onBack }: { user: MockUser; roles: MockRole[]; onBack: () => void }) {
  return (
    <div className="space-y-6">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft size={14} /> Back to users
      </button>

      {/* User header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-primary/15 flex items-center justify-center text-primary text-xl font-bold">
            {user.firstName.charAt(0)}{user.lastName.charAt(0)}
          </div>
          <div>
            <h2 className="text-xl font-bold text-foreground">{user.firstName} {user.lastName}</h2>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-sm text-muted-foreground">@{user.username}</span>
              {user.title && <span className="text-xs text-muted-foreground">&middot; {user.title}</span>}
              <ColorBadge label={user.status} color={user.status === 'active' ? 'success' : 'error'} dot />
              {user.ssoProvider && <ColorBadge label={`SSO: ${user.ssoProvider}`} color="info" />}
            </div>
          </div>
        </div>
        <Button onClick={() => toast.success('User updated')}><Save size={14} /> Save</Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <div className="space-y-6">
          {/* Identity card */}
          <Card>
            <CardHeader><CardTitle className="text-base">Identity</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5">Username</Label>
                  <Input type="text" defaultValue={user.username} className="font-mono" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5">Email</Label>
                  <Input type="email" defaultValue={user.email} />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5">First Name</Label>
                  <Input type="text" defaultValue={user.firstName} />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5">Last Name</Label>
                  <Input type="text" defaultValue={user.lastName} />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5">Title</Label>
                  <Input type="text" defaultValue={user.title ?? ''} placeholder="e.g. Senior Engineer" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5">Department</Label>
                  <Input type="text" defaultValue={user.department ?? ''} placeholder="e.g. Engineering" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5">Phone</Label>
                  <Input type="tel" defaultValue={user.phone ?? ''} placeholder="+1 (555) ..." />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5">Timezone</Label>
                  <SearchableSelect
                    value={user.timezone ?? 'UTC'}
                    onChange={() => {}}
                    placeholder="Select timezone..."
                    options={[
                      { value: 'UTC', label: 'UTC', description: 'Coordinated Universal Time' },
                      { value: 'America/New_York', label: 'America/New_York', description: 'Eastern Time (ET)' },
                      { value: 'America/Chicago', label: 'America/Chicago', description: 'Central Time (CT)' },
                      { value: 'America/Denver', label: 'America/Denver', description: 'Mountain Time (MT)' },
                      { value: 'America/Los_Angeles', label: 'America/Los_Angeles', description: 'Pacific Time (PT)' },
                      { value: 'Europe/London', label: 'Europe/London', description: 'Greenwich Mean Time (GMT)' },
                      { value: 'Europe/Paris', label: 'Europe/Paris', description: 'Central European Time (CET)' },
                      { value: 'Europe/Madrid', label: 'Europe/Madrid', description: 'Central European Time (CET)' },
                      { value: 'Asia/Tokyo', label: 'Asia/Tokyo', description: 'Japan Standard Time (JST)' },
                      { value: 'Asia/Seoul', label: 'Asia/Seoul', description: 'Korea Standard Time (KST)' },
                      { value: 'Asia/Shanghai', label: 'Asia/Shanghai', description: 'China Standard Time (CST)' },
                      { value: 'Australia/Sydney', label: 'Australia/Sydney', description: 'Australian Eastern Time (AET)' },
                    ]}
                  />
                </div>
              </div>
              {user.ssoProvider && (
                <div className="mt-4 p-3 rounded-lg bg-primary/5 border border-primary/20">
                  <div className="flex items-center gap-2 mb-1">
                    <ColorBadge label={`SSO: ${user.ssoProvider}`} color="info" dot />
                    <span className="text-xs text-muted-foreground">Identity managed externally</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">Subject ID: <code className="font-mono text-foreground/70">{user.ssoSubject}</code></p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Some fields may be synced from the identity provider and cannot be edited locally.</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Roles card */}
          <Card>
            <CardHeader><CardTitle className="text-base">Assigned Roles</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2 mb-3">
                {user.roles.map(rid => {
                  const r = roles.find(role => role.id === rid)
                  return r ? (
                    <div key={rid} className="flex items-center justify-between px-4 py-2.5 rounded-lg bg-background border border-border/50">
                      <div className="flex items-center gap-2.5">
                        <RoleBadge role={r} />
                        <span className="text-xs text-muted-foreground">{r.description}</span>
                      </div>
                      <button onClick={() => toast.info(`Role ${r.name} removed`)} className="text-xs text-muted-foreground hover:text-destructive transition-colors"><X size={14} /></button>
                    </div>
                  ) : null
                })}
              </div>
              {roles.filter(r => !user.roles.includes(r.id)).length > 0 && (
                <SearchableSelect
                  options={roles.filter(r => !user.roles.includes(r.id)).map(r => ({ value: r.id, label: r.name, description: r.description }))}
                  value=""
                  onChange={(v) => { if (v) toast.info(`Role ${v} assigned`) }}
                  placeholder="Assign additional role..."
                />
              )}
            </CardContent>
          </Card>

          {/* Effective Permissions */}
          <EffectivePermissionsPanel userRoles={user.roles} allRoles={roles} policies={initialPolicies} />

          {/* Security */}
          <Card>
            <CardHeader><CardTitle className="text-base">Authentication & Security</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-4 rounded-lg bg-background border border-border/50">
                    <div>
                      <p className="text-sm font-medium text-foreground">Password</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{user.ssoProvider ? 'Managed by SSO provider' : 'Last changed 30 days ago'}</p>
                    </div>
                    <Button variant="secondary" size="sm" onClick={() => toast.info('Password reset email sent')} disabled={!!user.ssoProvider}><KeyRound size={12} /> Reset</Button>
                  </div>

                  <div className="flex items-center justify-between p-4 rounded-lg bg-background border border-border/50">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-foreground">MFA</p>
                        <ColorBadge label={user.mfa} color={user.mfa === 'enabled' ? 'success' : 'muted'} dot />
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {user.mfa === 'enabled' ? (user.mfaType ?? 'totp').toUpperCase() : 'Not configured'}
                      </p>
                    </div>
                    {user.mfa === 'enabled' ? (
                      <Button variant="secondary" size="sm" onClick={() => toast.info('MFA reset')}><RotateCcw size={12} /> Reset</Button>
                    ) : (
                      <Button variant="secondary" size="sm" onClick={() => toast.info('MFA enrollment link sent')}>Require</Button>
                    )}
                  </div>

                  <div className="flex items-center justify-between p-4 rounded-lg bg-background border border-border/50">
                    <div>
                      <p className="text-sm font-medium text-foreground">Account status</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {user.status === 'active' ? 'Active -- can log in' : user.status === 'locked' ? 'Locked -- cannot log in' : 'Disabled'}
                      </p>
                    </div>
                    <ColorBadge label={user.status} color={user.status === 'active' ? 'success' : 'error'} dot />
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Active Sessions ({user.sessions.length})</h4>
                  {user.sessions.length === 0 ? (
                    <div className="flex items-center justify-center h-32 rounded-lg bg-background border border-border/50 text-xs text-muted-foreground">No active sessions</div>
                  ) : (
                    <div className="space-y-2">
                      {user.sessions.map(s => (
                        <div key={s.id} className="flex items-center justify-between px-4 py-3 rounded-lg bg-background border border-border/50">
                          <div className="flex items-center gap-3 min-w-0">
                            <Monitor size={14} className="text-muted-foreground shrink-0" />
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">{s.device}</p>
                              <p className="text-xs text-muted-foreground truncate">{s.ip} &middot; {s.lastActive}{s.location ? ` \u00B7 ${s.location}` : ''}</p>
                            </div>
                          </div>
                          <Button variant="destructive" size="sm" onClick={() => toast.success('Session revoked')}>Revoke</Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right sidebar */}
        <div className="space-y-4">
          <Card>
            <CardContent className="p-5">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Account Info</h4>
              <div className="space-y-3 text-sm">
                <div><span className="text-muted-foreground">Status</span><div className="mt-1"><ColorBadge label={user.status} color={user.status === 'active' ? 'success' : 'error'} dot /></div></div>
                <div><span className="text-muted-foreground">Auth method</span><div className="mt-0.5 text-foreground">{user.ssoProvider ? `SSO (${user.ssoProvider})` : 'Local'}</div></div>
                <div><span className="text-muted-foreground">Created</span><div className="mt-0.5 text-foreground">{user.created}</div></div>
                <div><span className="text-muted-foreground">Last modified</span><div className="mt-0.5 text-foreground">{user.lastModified}</div></div>
                <div><span className="text-muted-foreground">Last login</span><div className="mt-0.5 text-foreground">{user.lastLogin}</div></div>
                <div><span className="text-muted-foreground">Locale</span><div className="mt-0.5 text-foreground">{user.locale ?? 'en-US'}</div></div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-destructive/30">
            <CardContent className="p-5">
              <h4 className="text-xs font-semibold text-destructive mb-3">Danger Zone</h4>
              <div className="space-y-2">
                {user.status === 'active' && (
                  <Button variant="destructive" className="w-full" onClick={() => toast.error('Account locked')}>Lock account</Button>
                )}
                {user.status === 'locked' && (
                  <Button variant="outline" className="w-full border-green-500/30 text-green-600 hover:bg-green-500/10" onClick={() => toast.success('Account unlocked')}>Unlock account</Button>
                )}
                <Button variant="destructive" className="w-full" onClick={() => toast.error('User deleted')}>
                  <Trash2 size={14} /> Delete user permanently
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

// ─── Main page ───

export function UsersSecurityPage() {
  const { t } = useTranslation('users')
  const canManage = useHasPermission('users:manage')
  const [activeTab, setActiveTab] = useState<string>('users')
  const [showCreateUser, setShowCreateUser] = useState(false)
  const [selectedUser, setSelectedUser] = useState<MockUser | null>(null)
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>('operator')
  const [roles, setRoles] = useState(initialRoles)
  const [showCreateRole, setShowCreateRole] = useState(false)
  const [newRoleName, setNewRoleName] = useState('')
  const [newRoleDesc, setNewRoleDesc] = useState('')
  const [newRoleInherits, setNewRoleInherits] = useState<string[]>([])

  const selectedRole = roles.find(r => r.id === selectedRoleId)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users & Access"
        description="Manage users, role hierarchy, permissions, and conditional access"
        actions={
          activeTab === 'users' ? (
            <Button onClick={() => { setShowCreateUser(!showCreateUser); setSelectedUser(null) }}>
              <UserPlus size={16} /> Create user
            </Button>
          ) : activeTab === 'roles' ? (
            <Button onClick={() => setShowCreateRole(!showCreateRole)}>
              <Plus size={16} /> Create role
            </Button>
          ) : undefined
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList variant="line">
          <TabsTrigger value="users">
            <Users size={16} className="mr-1.5" />
            Users
            <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full ml-1.5">{initialUsers.length}</span>
          </TabsTrigger>
          <TabsTrigger value="roles">
            <Shield size={16} className="mr-1.5" />
            Roles
            <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full ml-1.5">{roles.length}</span>
          </TabsTrigger>
          <TabsTrigger value="policies">
            <Lock size={16} className="mr-1.5" />
            Access Policies
            <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full ml-1.5">{initialPolicies.length}</span>
          </TabsTrigger>
        </TabsList>

        {/* ═══ Users Tab ═══ */}
        <TabsContent value="users">
          <div className="space-y-4">
            {showCreateUser && (
              <Card className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold">Create New User</h3>
                  <button onClick={() => setShowCreateUser(false)} className="p-1 rounded-md hover:bg-muted text-muted-foreground"><X size={16} /></button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5">Username</Label>
                    <Input type="text" placeholder="e.g. jsmith" />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5">Email</Label>
                    <Input type="email" placeholder="jsmith@company.com" />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5">Password</Label>
                    <Input type="password" placeholder="Minimum 12 characters" />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5">Roles</Label>
                    <SearchableMultiSelect
                      options={roles.map(r => ({ value: r.id, label: r.name, description: r.description }))}
                      value={['viewer']}
                      onChange={() => {}}
                      placeholder="Add role..."
                    />
                    <p className="text-[11px] text-muted-foreground mt-1">Users can have multiple roles. Permissions are the union of all assigned roles.</p>
                  </div>
                </div>
                <div className="flex gap-3 mt-4">
                  <Button onClick={() => { setShowCreateUser(false); toast.success('User created') }}>
                    <UserPlus size={14} /> Create
                  </Button>
                  <Button variant="ghost" onClick={() => setShowCreateUser(false)}>Cancel</Button>
                </div>
              </Card>
            )}

            {selectedUser ? (
              <UserDetailView user={selectedUser} roles={roles} onBack={() => setSelectedUser(null)} />
            ) : (
              <div className="rounded-xl border border-border overflow-hidden overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-card/80">
                      <th className="px-5 py-3 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">User</th>
                      <th className="px-5 py-3 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Roles</th>
                      <th className="px-5 py-3 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                      <th className="px-5 py-3 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">MFA</th>
                      <th className="px-5 py-3 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Last Login</th>
                    </tr>
                  </thead>
                  <tbody>
                    {initialUsers.map(user => (
                      <tr
                        key={user.id}
                        onClick={() => { setSelectedUser(user); setShowCreateUser(false) }}
                        className="border-t border-border/40 hover:bg-accent/40 cursor-pointer transition-colors"
                      >
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center text-primary text-xs font-bold shrink-0">{user.firstName.charAt(0)}{user.lastName.charAt(0)}</div>
                            <div>
                              <p className="text-sm font-medium text-foreground">{user.firstName} {user.lastName}</p>
                              <p className="text-xs text-muted-foreground">@{user.username} &middot; {user.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {user.roles.map(rid => {
                              const r = roles.find(role => role.id === rid)
                              return r ? <RoleBadge key={rid} role={r} /> : null
                            })}
                          </div>
                        </td>
                        <td className="px-5 py-3.5"><ColorBadge label={user.status} color={user.status === 'active' ? 'success' : 'error'} dot /></td>
                        <td className="px-5 py-3.5"><span className={cn('text-xs font-medium', user.mfa === 'enabled' ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground')}>{user.mfa === 'enabled' ? 'Enabled' : '\u2014'}</span></td>
                        <td className="px-5 py-3.5 text-sm text-muted-foreground">{user.lastLogin}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ═══ Roles Tab ═══ */}
        <TabsContent value="roles">
          <div className="space-y-6">
            {showCreateRole && (
              <Card className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold">Create New Role</h3>
                  <button onClick={() => setShowCreateRole(false)} className="p-1 rounded-md hover:bg-muted text-muted-foreground"><X size={16} /></button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5">Role Name</Label>
                    <Input type="text" value={newRoleName} onChange={e => setNewRoleName(e.target.value)} placeholder="e.g. Support Agent" />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5">Inherits from</Label>
                    <SearchableMultiSelect
                      options={roles.map(r => ({ value: r.id, label: r.name, description: r.description }))}
                      value={newRoleInherits}
                      onChange={setNewRoleInherits}
                      placeholder="Add parent..."
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5">Description</Label>
                    <Input type="text" value={newRoleDesc} onChange={e => setNewRoleDesc(e.target.value)} placeholder="What can this role do?" />
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground mb-4">You can add permission rules after creating the role.</p>
                <div className="flex gap-3">
                  <Button onClick={() => {
                    if (!newRoleName.trim()) { toast.error('Role name is required'); return }
                    const newRole: MockRole = { id: newRoleName.toLowerCase().replace(/\s+/g, '-'), name: newRoleName, description: newRoleDesc, inherits: newRoleInherits, builtIn: false, color: 'warning', memberCount: 0, rules: [] }
                    setRoles([...roles, newRole])
                    setSelectedRoleId(newRole.id)
                    setShowCreateRole(false)
                    setNewRoleName(''); setNewRoleDesc(''); setNewRoleInherits([])
                    toast.success(`Role "${newRoleName}" created`)
                  }}><Plus size={14} /> Create</Button>
                  <Button variant="ghost" onClick={() => setShowCreateRole(false)}>Cancel</Button>
                </div>
              </Card>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
              <div className="min-w-0">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Role Hierarchy</h3>
                  <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">{roles.length} roles</span>
                </div>
                <div className="overflow-y-auto max-h-[calc(100vh-280px)] pr-1">
                  <RoleHierarchyTree roles={roles} selectedId={selectedRoleId} onSelect={setSelectedRoleId} />
                </div>
              </div>
              <Card className="p-6 overflow-y-auto max-h-[calc(100vh-280px)]">
                {selectedRole ? (
                  <RoleDetail
                    role={selectedRole}
                    roles={roles}
                    onUpdate={(updated) => setRoles(roles.map(r => r.id === updated.id ? updated : r))}
                    onNavigateToUser={(user) => { setSelectedUser(user); setActiveTab('users') }}
                  />
                ) : (
                  <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">Select a role to view details</div>
                )}
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* ═══ Access Policies Tab ═══ */}
        <TabsContent value="policies">
          <AccessPoliciesTab policies={initialPolicies} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
