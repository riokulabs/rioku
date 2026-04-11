import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/components/ui/input', () => ({ Input: (props: React.ComponentProps<'input'>) => <input {...props} /> }))
vi.mock('@/components/ui/label', () => ({ Label: ({ children, ...props }: React.ComponentProps<'label'>) => <label {...props}>{children}</label> }))
vi.mock('@/components/ui/button', () => ({ Button: ({ children, onClick, ...props }: React.ComponentProps<'button'>) => <button onClick={onClick} {...props}>{children}</button> }))
vi.mock('@/components/ui/switch', () => ({ Switch: ({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (v: boolean) => void }) => <button role="switch" aria-checked={checked} onClick={() => onCheckedChange(!checked)} /> }))
vi.mock('@/components/ui/select', () => ({ Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>, SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => <option value={value}>{children}</option>, SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, SelectValue: () => <span /> }))
vi.mock('@/components/rioku/tag-input', () => ({ TagInput: ({ value, placeholder }: { value: string[]; placeholder?: string }) => <div data-testid="tag-input"><input placeholder={placeholder} />{value.map((v, i) => <span key={i}>{v}</span>)}</div> }))
vi.mock('lucide-react', () => ({ PlusIcon: () => <span>+</span>, TrashIcon: () => <span>x</span> }))

import { ConditionEditor } from '../condition-editor'

describe('ConditionEditor', () => {
  it('renders existing conditions', () => {
    render(<ConditionEditor value={[{ type: 'ip', config: { cidrRanges: ['10.0.0.0/8'], negate: false } }]} onChange={vi.fn()} />)
    expect(screen.getByText('10.0.0.0/8')).toBeInTheDocument()
  })

  it('renders add condition button', () => {
    render(<ConditionEditor value={[]} onChange={vi.fn()} />)
    expect(screen.getByText('Add condition')).toBeInTheDocument()
  })

  it('adds condition when button clicked', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<ConditionEditor value={[]} onChange={onChange} />)
    await user.click(screen.getByText('Add condition'))
    expect(onChange).toHaveBeenCalled()
    expect(onChange.mock.calls[0][0]).toHaveLength(1)
  })

  it('removes condition when delete clicked', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<ConditionEditor value={[{ type: 'ip', config: {} }]} onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: /remove/i }))
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('renders MFA condition fields', () => {
    render(<ConditionEditor value={[{ type: 'mfa', config: { required: true } }]} onChange={vi.fn()} />)
    expect(screen.getByText('MFA must be enabled')).toBeInTheDocument()
  })
})
