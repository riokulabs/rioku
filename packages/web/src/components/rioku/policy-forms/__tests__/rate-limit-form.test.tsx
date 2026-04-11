import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.ComponentProps<'input'>) => <input {...props} />,
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, ...props }: React.ComponentProps<'label'>) => <label {...props}>{children}</label>,
}))

vi.mock('@/components/ui/switch', () => ({
  Switch: ({ id, checked, onCheckedChange, disabled }: { id?: string; checked: boolean; onCheckedChange: (v: boolean) => void; disabled?: boolean }) => (
    <button
      role="switch"
      aria-checked={checked}
      id={id}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      data-testid={`switch-${id}`}
    >
      {checked ? 'On' : 'Off'}
    </button>
  ),
}))

vi.mock('@/components/ui/select', () => ({
  Select: ({ children, value, onValueChange, disabled }: { children: React.ReactNode; value: string; onValueChange: (v: string) => void; disabled?: boolean }) => (
    <div data-testid="select">{children}</div>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => <option value={value}>{children}</option>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: () => <span />,
}))

import { RateLimitForm } from '../rate-limit-form'

describe('RateLimitForm', () => {
  const defaultValue = {
    requestsPerWindow: 100,
    windowUnit: 'minute',
    scope: 'per_ip',
    responseWhenLimited: '429',
  }

  it('renders requests per window number input', () => {
    render(<RateLimitForm value={defaultValue} onChange={vi.fn()} />)
    const input = screen.getByLabelText('Requests per window')
    expect(input).toBeInTheDocument()
    expect(input).toHaveValue(100)
  })

  it('renders window unit selector', () => {
    render(<RateLimitForm value={defaultValue} onChange={vi.fn()} />)
    expect(screen.getByText('Window unit')).toBeInTheDocument()
  })

  it('renders scope selector', () => {
    render(<RateLimitForm value={defaultValue} onChange={vi.fn()} />)
    expect(screen.getByText('Scope')).toBeInTheDocument()
  })

  it('shows token-aware fields when toggle enabled', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<RateLimitForm value={{ ...defaultValue, tokenAware: false }} onChange={onChange} />)

    const toggle = screen.getByTestId('switch-tokenAware')
    await user.click(toggle)
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ tokenAware: true }))
  })

  it('hides token fields when toggle disabled', () => {
    render(<RateLimitForm value={{ ...defaultValue, tokenAware: false }} onChange={vi.fn()} />)
    expect(screen.queryByLabelText('Input token limit')).not.toBeInTheDocument()
  })

  it('shows token fields when tokenAware is true', () => {
    render(<RateLimitForm value={{ ...defaultValue, tokenAware: true }} onChange={vi.fn()} />)
    expect(screen.getByLabelText('Input token limit')).toBeInTheDocument()
    expect(screen.getByLabelText('Output token limit')).toBeInTheDocument()
    expect(screen.getByLabelText('Total token limit')).toBeInTheDocument()
  })

  it('shows cost-aware fields when toggle enabled', () => {
    render(<RateLimitForm value={{ ...defaultValue, costAware: true }} onChange={vi.fn()} />)
    expect(screen.getByLabelText('Daily budget (USD)')).toBeInTheDocument()
  })

  it('renders burst allowance input', () => {
    render(<RateLimitForm value={defaultValue} onChange={vi.fn()} />)
    expect(screen.getByLabelText('Burst allowance')).toBeInTheDocument()
  })

  it('renders response selector', () => {
    render(<RateLimitForm value={defaultValue} onChange={vi.fn()} />)
    expect(screen.getByText('Response when limited')).toBeInTheDocument()
  })

  it('calls onChange when input changes', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<RateLimitForm value={defaultValue} onChange={onChange} />)

    const input = screen.getByLabelText('Requests per window')
    await user.clear(input)
    await user.type(input, '200')
    expect(onChange).toHaveBeenCalled()
  })

  it('shows validation errors', () => {
    render(
      <RateLimitForm
        value={defaultValue}
        onChange={vi.fn()}
        errors={{ requestsPerWindow: 'Required' }}
      />,
    )
    expect(screen.getByText('Required')).toBeInTheDocument()
  })
})
