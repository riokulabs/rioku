import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmDialog } from '../confirm-dialog'

describe('ConfirmDialog', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    title: 'Delete Route',
    description: 'Are you sure you want to delete this route?',
    onConfirm: vi.fn(),
  }

  it('renders title and description when open', () => {
    render(<ConfirmDialog {...defaultProps} />)

    expect(screen.getByText('Delete Route')).toBeInTheDocument()
    expect(
      screen.getByText('Are you sure you want to delete this route?'),
    ).toBeInTheDocument()
  })

  it('calls onConfirm when confirm button clicked', async () => {
    const onConfirm = vi.fn()
    const user = userEvent.setup()

    render(<ConfirmDialog {...defaultProps} onConfirm={onConfirm} />)

    await user.click(screen.getByRole('button', { name: /confirm/i }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('calls onOpenChange(false) when cancel button clicked', async () => {
    const onOpenChange = vi.fn()
    const user = userEvent.setup()

    render(
      <ConfirmDialog {...defaultProps} onOpenChange={onOpenChange} />,
    )

    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('uses custom confirm label', () => {
    render(
      <ConfirmDialog {...defaultProps} confirmLabel="Delete Forever" />,
    )

    expect(
      screen.getByRole('button', { name: /delete forever/i }),
    ).toBeInTheDocument()
  })

  it('disables buttons when loading', () => {
    render(<ConfirmDialog {...defaultProps} loading={true} />)

    // Get the dialog footer and check only actual action buttons (not base-ui focus guards)
    const footer = document.querySelector('[data-slot="dialog-footer"]')
    expect(footer).toBeTruthy()
    const buttons = within(footer as HTMLElement).getAllByRole('button')
    for (const button of buttons) {
      expect(button).toBeDisabled()
    }
  })

  it('shows spinner icon when loading', () => {
    render(
      <ConfirmDialog {...defaultProps} loading={true} />,
    )

    // The LoaderIcon renders as an SVG inside the confirm button
    const confirmButton = screen.getByRole('button', { name: /confirm/i })
    const svg = confirmButton.querySelector('svg')
    expect(svg).toBeInTheDocument()
  })

  it('does not render content when open is false', () => {
    render(<ConfirmDialog {...defaultProps} open={false} />)

    expect(screen.queryByText('Delete Route')).not.toBeInTheDocument()
  })
})
