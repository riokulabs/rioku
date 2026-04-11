import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TypedConfirmationDialog } from '../typed-confirmation-dialog'

describe('TypedConfirmationDialog', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    title: 'Factory Reset',
    description: 'This will erase all data.',
    confirmPhrase: 'factory reset rioku',
    onConfirm: vi.fn(),
  }

  it('renders title and description', () => {
    render(<TypedConfirmationDialog {...defaultProps} />)
    expect(screen.getByText('Factory Reset')).toBeInTheDocument()
    expect(screen.getByText('This will erase all data.')).toBeInTheDocument()
  })

  it('shows the required phrase', () => {
    render(<TypedConfirmationDialog {...defaultProps} />)
    expect(screen.getByText(/factory reset rioku/)).toBeInTheDocument()
  })

  it('disables confirm button until phrase is typed correctly', () => {
    render(<TypedConfirmationDialog {...defaultProps} />)
    const confirmBtn = screen.getByRole('button', { name: /confirm/i })
    expect(confirmBtn).toBeDisabled()
  })

  it('enables confirm button when phrase matches', async () => {
    const user = userEvent.setup()
    render(<TypedConfirmationDialog {...defaultProps} />)

    const input = screen.getByRole('textbox')
    await user.type(input, 'factory reset rioku')

    const confirmBtn = screen.getByRole('button', { name: /confirm/i })
    expect(confirmBtn).not.toBeDisabled()
  })

  it('calls onConfirm when phrase matches and button clicked', async () => {
    const onConfirm = vi.fn()
    const user = userEvent.setup()

    render(
      <TypedConfirmationDialog {...defaultProps} onConfirm={onConfirm} />,
    )

    const input = screen.getByRole('textbox')
    await user.type(input, 'factory reset rioku')
    await user.click(screen.getByRole('button', { name: /confirm/i }))

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('does not call onConfirm when phrase is wrong', async () => {
    const onConfirm = vi.fn()
    const user = userEvent.setup()

    render(
      <TypedConfirmationDialog {...defaultProps} onConfirm={onConfirm} />,
    )

    const input = screen.getByRole('textbox')
    await user.type(input, 'wrong phrase')

    const confirmBtn = screen.getByRole('button', { name: /confirm/i })
    expect(confirmBtn).toBeDisabled()
  })

  it('resets input when closed and reopened', () => {
    const { rerender } = render(
      <TypedConfirmationDialog {...defaultProps} open={false} />,
    )
    rerender(<TypedConfirmationDialog {...defaultProps} open={true} />)
    const input = screen.getByRole('textbox')
    expect(input).toHaveValue('')
  })
})
