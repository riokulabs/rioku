import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/components/ui/badge', () => ({ Badge: ({ children }: { children: React.ReactNode }) => <span data-testid="badge">{children}</span> }))
vi.mock('@/components/ui/label', () => ({ Label: ({ children }: { children: React.ReactNode }) => <label>{children}</label> }))

import { RoleHierarchyTree } from '../role-hierarchy-tree'
import type { ExpandedRole } from '@/lib/api'

const viewerRole: ExpandedRole = { id: 'r1', name: 'viewer', description: '', isBuiltin: true, permissions: [], createdAt: '', updatedAt: '', parentRoleIds: [], childRoleIds: ['r2'] }
const operatorRole: ExpandedRole = { id: 'r2', name: 'operator', description: '', isBuiltin: true, permissions: [], createdAt: '', updatedAt: '', parentRoleIds: ['r1'], childRoleIds: [] }

describe('RoleHierarchyTree', () => {
  it('renders parent roles', () => {
    render(<RoleHierarchyTree role={operatorRole} allRoles={[viewerRole, operatorRole]} />)
    expect(screen.getByText('viewer')).toBeInTheDocument()
  })

  it('renders child roles', () => {
    render(<RoleHierarchyTree role={viewerRole} allRoles={[viewerRole, operatorRole]} />)
    expect(screen.getByText('operator')).toBeInTheDocument()
  })

  it('shows no parent message when empty', () => {
    render(<RoleHierarchyTree role={viewerRole} allRoles={[viewerRole]} />)
    expect(screen.getByText('No parent roles')).toBeInTheDocument()
  })

  it('shows coming soon in edit mode', () => {
    render(<RoleHierarchyTree role={viewerRole} allRoles={[viewerRole]} readOnly={false} />)
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument()
  })
})
