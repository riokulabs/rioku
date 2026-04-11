import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// Mock the hook to control dialog state directly
const mockExtendSession = vi.fn()
const mockHookState = {
  timeRemaining: 120,
  showWarning: true,
  isExpired: false,
  extendSession: mockExtendSession,
  isExtending: false,
}

vi.mock('@/hooks/use-session-timeout', () => ({
  useSessionTimeout: () => mockHookState,
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}))

import { SessionTimeoutDialog } from '../session-timeout-dialog'

describe('SessionTimeoutDialog', () => {
  it('renders when showWarning is true', () => {
    mockHookState.showWarning = true
    mockHookState.isExpired = false
    render(<SessionTimeoutDialog />)
    expect(screen.getByText('Session Expiring')).toBeDefined()
  })

  it('does not render session content when showWarning is false', () => {
    mockHookState.showWarning = false
    mockHookState.isExpired = false
    render(<SessionTimeoutDialog />)
    expect(screen.queryByText('Session Expiring')).toBeNull()
  })

  it('displays countdown timer', () => {
    mockHookState.showWarning = true
    mockHookState.isExpired = false
    mockHookState.timeRemaining = 120
    render(<SessionTimeoutDialog />)
    expect(screen.getByTestId('session-countdown').textContent).toBe('2:00')
  })

  it('shows Extend Session button', () => {
    mockHookState.showWarning = true
    mockHookState.isExpired = false
    render(<SessionTimeoutDialog />)
    expect(screen.getByTestId('extend-session-btn')).toBeDefined()
  })

  it('shows Log Out button', () => {
    mockHookState.showWarning = true
    mockHookState.isExpired = false
    render(<SessionTimeoutDialog />)
    expect(screen.getByTestId('logout-btn')).toBeDefined()
  })
})
