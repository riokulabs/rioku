import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StaleIndicator } from '../stale-indicator'

describe('StaleIndicator', () => {
  it('renders time ago text', () => {
    const now = new Date().toISOString()
    render(<StaleIndicator dataUpdatedAt={now} />)
    expect(screen.getByTestId('stale-indicator')).toBeDefined()
    expect(screen.getByText(/Last updated/)).toBeDefined()
  })

  it('shows refresh button when onRefresh provided', () => {
    const now = new Date().toISOString()
    render(<StaleIndicator dataUpdatedAt={now} onRefresh={() => {}} />)
    expect(screen.getByTestId('refresh-button')).toBeDefined()
  })

  it('calls onRefresh when button clicked', async () => {
    const onRefresh = vi.fn()
    const now = new Date().toISOString()
    render(<StaleIndicator dataUpdatedAt={now} onRefresh={onRefresh} />)
    await userEvent.click(screen.getByTestId('refresh-button'))
    expect(onRefresh).toHaveBeenCalledOnce()
  })

  it('does not show refresh button when onRefresh is undefined', () => {
    const now = new Date().toISOString()
    render(<StaleIndicator dataUpdatedAt={now} />)
    expect(screen.queryByTestId('refresh-button')).toBeNull()
  })

  it('accepts numeric timestamp', () => {
    render(<StaleIndicator dataUpdatedAt={Date.now()} />)
    expect(screen.getByTestId('stale-indicator')).toBeDefined()
  })
})
