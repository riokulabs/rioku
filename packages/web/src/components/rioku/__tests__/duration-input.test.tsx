import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.ComponentProps<'input'>) => <input {...props} />,
}))

vi.mock('@/components/ui/select', () => ({
  Select: ({ children, value, onValueChange }: { children: React.ReactNode; value: string; onValueChange: (v: string) => void }) => (
    <div data-testid="select">{children}</div>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => <option value={value}>{children}</option>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: () => <span data-testid="select-value" />,
}))

import { DurationInput } from '../duration-input'

describe('DurationInput', () => {
  it('renders number input', () => {
    render(<DurationInput value="30s" onChange={vi.fn()} />)
    const input = screen.getByRole('spinbutton')
    expect(input).toBeInTheDocument()
    expect(input).toHaveValue(30)
  })

  it('renders unit selector', () => {
    render(<DurationInput value="30s" onChange={vi.fn()} />)
    expect(screen.getByTestId('select')).toBeInTheDocument()
  })

  it('parses initial value string', () => {
    render(<DurationInput value="100ms" onChange={vi.fn()} />)
    const input = screen.getByRole('spinbutton')
    expect(input).toHaveValue(100)
  })

  it('calls onChange when number changes', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<DurationInput value="30s" onChange={onChange} />)
    const input = screen.getByRole('spinbutton')
    await user.clear(input)
    await user.type(input, '60')
    expect(onChange).toHaveBeenCalled()
  })
})
