import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import type { ReactNode } from 'react';
import { ErrorBoundary, ErrorBoundaryFallback } from './error-boundary';

function Wrapper({ children }: { children: ReactNode }) {
  return <MantineProvider>{children}</MantineProvider>;
}

// Suppress expected console.error output during tests
const originalError = console.error;
beforeEach(() => {
  console.error = vi.fn();
});
afterEach(() => {
  console.error = originalError;
});

function ThrowingChild({ message }: { message: string }): never {
  throw new Error(message);
}

describe('ErrorBoundary', () => {
  it('renders children when no error is thrown', () => {
    render(
      <ErrorBoundary>
        <span>ok</span>
      </ErrorBoundary>,
      { wrapper: Wrapper },
    );
    expect(screen.getByText('ok')).toBeInTheDocument();
  });

  it('catches a child throw and renders the fallback UI', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild message="test render error" />
      </ErrorBoundary>,
      { wrapper: Wrapper },
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('test render error')).toBeInTheDocument();
  });

  it('renders a retry button that calls window.location.reload', async () => {
    const reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { reload: reloadSpy },
      writable: true,
    });

    render(
      <ErrorBoundary>
        <ThrowingChild message="reload test" />
      </ErrorBoundary>,
      { wrapper: Wrapper },
    );

    const retryButton = screen.getByRole('button', { name: /try again/i });
    await userEvent.click(retryButton);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('logs the error to console.error', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild message="logged error" />
      </ErrorBoundary>,
      { wrapper: Wrapper },
    );
    expect(console.error).toHaveBeenCalled();
  });
});

describe('ErrorBoundaryFallback', () => {
  it('renders the error message and a retry button', () => {
    render(<ErrorBoundaryFallback error={new Error('route error')} />, { wrapper: Wrapper });
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('route error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});
