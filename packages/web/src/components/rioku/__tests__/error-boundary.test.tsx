import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ErrorBoundary } from '../error-boundary'

// A component that throws on demand
function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('Test explosion')
  }
  return <div data-testid="child">All good</div>
}

// Suppress console.error for expected error boundary logs
const originalConsoleError = console.error
beforeEach(() => {
  console.error = vi.fn()
  return () => {
    console.error = originalConsoleError
  }
})

describe('ErrorBoundary', () => {
  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={false} />
      </ErrorBoundary>,
    )

    expect(screen.getByTestId('child')).toBeInTheDocument()
    expect(screen.getByText('All good')).toBeInTheDocument()
  })

  it('renders default fallback when child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>,
    )

    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.queryByTestId('child')).not.toBeInTheDocument()
  })

  it('shows error message in dev mode', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>,
    )

    // import.meta.env.DEV is true in test environment
    expect(screen.getByTestId('error-boundary-message')).toBeInTheDocument()
    expect(screen.getByText('Test explosion')).toBeInTheDocument()
  })

  it('renders Retry button that resets the boundary', async () => {
    const user = userEvent.setup()

    // We need a component that can toggle its throw behavior
    let shouldThrow = true
    function Toggler() {
      if (shouldThrow) {
        throw new Error('Boom')
      }
      return <div data-testid="recovered">Recovered</div>
    }

    const { rerender } = render(
      <ErrorBoundary>
        <Toggler />
      </ErrorBoundary>,
    )

    expect(screen.getByText('Something went wrong')).toBeInTheDocument()

    // Fix the underlying issue
    shouldThrow = false

    // Click retry
    await user.click(screen.getByText('Retry'))

    // Re-render to pick up the fixed component
    rerender(
      <ErrorBoundary>
        <Toggler />
      </ErrorBoundary>,
    )

    expect(screen.getByTestId('recovered')).toBeInTheDocument()
  })

  it('renders custom fallback when provided', () => {
    render(
      <ErrorBoundary fallback={<div data-testid="custom-fallback">Custom error UI</div>}>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>,
    )

    expect(screen.getByTestId('custom-fallback')).toBeInTheDocument()
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
  })

  it('calls onError callback when error occurs', () => {
    const onError = vi.fn()

    render(
      <ErrorBoundary onError={onError}>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>,
    )

    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Test explosion' }),
      expect.objectContaining({ componentStack: expect.any(String) }),
    )
  })
})
