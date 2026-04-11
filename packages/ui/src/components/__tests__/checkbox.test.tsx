import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Checkbox } from '../checkbox'

describe('Checkbox', () => {
  it('renders in unchecked state', () => {
    render(<Checkbox checked={false} onChange={() => {}} aria-label="Toggle" />)

    const checkbox = screen.getByRole('checkbox', { name: 'Toggle' })
    expect(checkbox).toBeInTheDocument()
    expect(checkbox).toHaveAttribute('aria-checked', 'false')
  })

  it('renders in checked state', () => {
    render(<Checkbox checked={true} onChange={() => {}} aria-label="Toggle" />)

    const checkbox = screen.getByRole('checkbox', { name: 'Toggle' })
    expect(checkbox).toHaveAttribute('aria-checked', 'true')
  })

  it('renders in indeterminate state', () => {
    render(
      <Checkbox checked="indeterminate" onChange={() => {}} aria-label="Toggle" />,
    )

    const checkbox = screen.getByRole('checkbox', { name: 'Toggle' })
    expect(checkbox).toHaveAttribute('aria-checked', 'mixed')
  })

  it('calls onChange with true when clicking unchecked', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<Checkbox checked={false} onChange={onChange} aria-label="Toggle" />)

    const checkbox = screen.getByRole('checkbox', { name: 'Toggle' })
    await user.click(checkbox)

    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('calls onChange with false when clicking checked', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<Checkbox checked={true} onChange={onChange} aria-label="Toggle" />)

    const checkbox = screen.getByRole('checkbox', { name: 'Toggle' })
    await user.click(checkbox)

    expect(onChange).toHaveBeenCalledWith(false)
  })

  it('calls onChange with true when clicking indeterminate', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <Checkbox checked="indeterminate" onChange={onChange} aria-label="Toggle" />,
    )

    const checkbox = screen.getByRole('checkbox', { name: 'Toggle' })
    await user.click(checkbox)

    // Indeterminate should transition to checked
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('does not call onChange when disabled', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <Checkbox checked={false} onChange={onChange} disabled aria-label="Toggle" />,
    )

    const checkbox = screen.getByRole('checkbox', { name: 'Toggle' })
    await user.click(checkbox)

    expect(onChange).not.toHaveBeenCalled()
  })

  it('has aria-disabled when disabled', () => {
    render(
      <Checkbox checked={false} onChange={() => {}} disabled aria-label="Toggle" />,
    )

    const checkbox = screen.getByRole('checkbox', { name: 'Toggle' })
    expect(checkbox).toHaveAttribute('aria-disabled', 'true')
  })

  it('responds to Space key press', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<Checkbox checked={false} onChange={onChange} aria-label="Toggle" />)

    const checkbox = screen.getByRole('checkbox', { name: 'Toggle' })
    checkbox.focus()
    await user.keyboard(' ')

    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('applies focus-visible ring class', () => {
    render(<Checkbox checked={false} onChange={() => {}} aria-label="Toggle" />)

    const checkbox = screen.getByRole('checkbox', { name: 'Toggle' })
    // The element should have focus-visible classes in its className
    expect(checkbox.className).toContain('focus-visible:ring-2')
  })

  it('applies custom className', () => {
    const { container } = render(
      <Checkbox
        checked={false}
        onChange={() => {}}
        className="my-custom-class"
        aria-label="Toggle"
      />,
    )

    const wrapper = container.firstElementChild
    expect(wrapper?.className).toContain('my-custom-class')
  })
})
