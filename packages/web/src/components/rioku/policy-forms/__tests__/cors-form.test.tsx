import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, ...props }: React.ComponentProps<'label'>) => <label {...props}>{children}</label>,
}))

vi.mock('@/components/ui/switch', () => ({
  Switch: ({ id, checked, onCheckedChange }: { id?: string; checked: boolean; onCheckedChange: (v: boolean) => void }) => (
    <button role="switch" aria-checked={checked} id={id} onClick={() => onCheckedChange(!checked)}>
      {checked ? 'On' : 'Off'}
    </button>
  ),
}))

vi.mock('@rioku/ui', () => ({
  Checkbox: ({ checked, onCheckedChange, disabled }: { checked: boolean; onCheckedChange: () => void; disabled?: boolean }) => (
    <input type="checkbox" checked={checked} onChange={onCheckedChange} disabled={disabled} />
  ),
}))

vi.mock('@/components/rioku/tag-input', () => ({
  TagInput: ({ value, onChange, placeholder }: { value: string[]; onChange: (tags: string[]) => void; placeholder?: string }) => (
    <div data-testid="tag-input">
      {value.map((t) => <span key={t}>{t}</span>)}
      <input placeholder={placeholder} />
    </div>
  ),
}))

vi.mock('@/components/rioku/duration-input', () => ({
  DurationInput: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input data-testid="duration-input" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

import { CorsForm } from '../cors-form'

describe('CorsForm', () => {
  const defaultValue = {
    allowedOrigins: ['https://example.com'],
    allowedMethods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
    exposedHeaders: [],
    maxAge: '3600s',
    allowCredentials: false,
  }

  it('renders allowed origins TagInput', () => {
    render(<CorsForm value={defaultValue} onChange={vi.fn()} />)
    expect(screen.getByText('Allowed origins')).toBeInTheDocument()
    expect(screen.getByText('https://example.com')).toBeInTheDocument()
  })

  it('renders allowed methods checkboxes', () => {
    render(<CorsForm value={defaultValue} onChange={vi.fn()} />)
    expect(screen.getByText('Allowed methods')).toBeInTheDocument()
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes.length).toBeGreaterThanOrEqual(7) // 7 HTTP methods
  })

  it('renders allowed headers TagInput', () => {
    render(<CorsForm value={defaultValue} onChange={vi.fn()} />)
    expect(screen.getByText('Allowed headers')).toBeInTheDocument()
  })

  it('renders exposed headers TagInput', () => {
    render(<CorsForm value={defaultValue} onChange={vi.fn()} />)
    expect(screen.getByText('Exposed headers')).toBeInTheDocument()
  })

  it('renders max age DurationInput', () => {
    render(<CorsForm value={defaultValue} onChange={vi.fn()} />)
    expect(screen.getByText('Max age')).toBeInTheDocument()
    expect(screen.getByTestId('duration-input')).toBeInTheDocument()
  })

  it('renders allow credentials toggle', () => {
    render(<CorsForm value={defaultValue} onChange={vi.fn()} />)
    expect(screen.getByText('Allow credentials')).toBeInTheDocument()
    expect(screen.getByRole('switch')).toBeInTheDocument()
  })

  it('shows validation errors', () => {
    render(
      <CorsForm
        value={defaultValue}
        onChange={vi.fn()}
        errors={{ allowedOrigins: 'At least one origin required' }}
      />,
    )
    expect(screen.getByText('At least one origin required')).toBeInTheDocument()
  })
})
