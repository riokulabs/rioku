import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FieldError } from '../field-error'

describe('FieldError', () => {
  it('renders message text', () => {
    render(<FieldError message="Name is required" />)
    expect(screen.getByText('Name is required')).toBeDefined()
  })

  it('has role="alert"', () => {
    render(<FieldError message="Error" />)
    expect(screen.getByRole('alert')).toBeDefined()
  })

  it('renders nothing when no message', () => {
    const { container } = render(<FieldError />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when message is empty string', () => {
    const { container } = render(<FieldError message="" />)
    expect(container.firstChild).toBeNull()
  })

  it('sets correct id for aria-describedby', () => {
    render(<FieldError message="Error" id="error-name" />)
    const el = screen.getByRole('alert')
    expect(el.id).toBe('error-name')
  })
})
