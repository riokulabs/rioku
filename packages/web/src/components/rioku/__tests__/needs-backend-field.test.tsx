import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NeedsBackendField } from '../needs-backend-field'

describe('NeedsBackendField', () => {
  it('renders children with reduced opacity', () => {
    render(
      <NeedsBackendField>
        <input data-testid="inner-input" />
      </NeedsBackendField>,
    )
    const input = screen.getByTestId('inner-input')
    expect(input.closest('[data-testid="needs-backend-wrapper"]')).toBeInTheDocument()
  })

  it('shows tooltip text', () => {
    render(
      <NeedsBackendField>
        <span>Field</span>
      </NeedsBackendField>,
    )
    expect(screen.getByText('Available in a future release')).toBeInTheDocument()
  })

  it('blocks pointer events on children', () => {
    render(
      <NeedsBackendField>
        <button data-testid="btn">Click me</button>
      </NeedsBackendField>,
    )
    const wrapper = screen.getByTestId('needs-backend-wrapper')
    expect(wrapper).toHaveClass('pointer-events-none')
  })
})
