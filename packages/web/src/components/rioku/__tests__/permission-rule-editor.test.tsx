import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/components/ui/input', () => ({ Input: (props: React.ComponentProps<'input'>) => <input {...props} /> }))
vi.mock('@/components/ui/label', () => ({ Label: ({ children, ...props }: React.ComponentProps<'label'>) => <label {...props}>{children}</label> }))
vi.mock('@/components/ui/button', () => ({ Button: ({ children, onClick, ...props }: React.ComponentProps<'button'>) => <button onClick={onClick} {...props}>{children}</button> }))
vi.mock('@rioku/ui', () => ({ Checkbox: ({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: () => void }) => <input type="checkbox" checked={checked} onChange={onCheckedChange} /> }))
vi.mock('@/components/ui/select', () => ({ Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>, SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => <option value={value}>{children}</option>, SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, SelectValue: () => <span /> }))
vi.mock('lucide-react', () => ({ PlusIcon: () => <span>+</span>, TrashIcon: () => <span>x</span> }))

import { PermissionRuleEditor } from '../permission-rule-editor'

const mockRules = [
  { id: '1', resource: 'routes', actions: ['view', 'create'], scope: 'all' as const, effect: 'allow' as const },
]

describe('PermissionRuleEditor', () => {
  it('renders existing rules as cards', () => {
    render(<PermissionRuleEditor value={mockRules} onChange={vi.fn()} />)
    expect(screen.getByText('Resource')).toBeInTheDocument()
    expect(screen.getByText('Effect')).toBeInTheDocument()
  })

  it('renders action checkboxes', () => {
    render(<PermissionRuleEditor value={mockRules} onChange={vi.fn()} />)
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes.length).toBe(5)
  })

  it('adds new rule when Add clicked', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<PermissionRuleEditor value={[]} onChange={onChange} />)
    await user.click(screen.getByText('Add rule'))
    expect(onChange).toHaveBeenCalled()
    expect(onChange.mock.calls[0][0]).toHaveLength(1)
  })

  it('removes rule when delete clicked', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<PermissionRuleEditor value={mockRules} onChange={onChange} />)
    const removeButton = screen.getByRole('button', { name: /remove/i })
    await user.click(removeButton)
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('hides controls when readOnly', () => {
    render(<PermissionRuleEditor value={mockRules} onChange={vi.fn()} readOnly />)
    expect(screen.queryByText('Add rule')).not.toBeInTheDocument()
  })
})
