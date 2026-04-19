import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { ErrorState } from './index';

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MantineProvider>{children}</MantineProvider>;
}

describe('ErrorState', () => {
  it('renders default title when none provided', () => {
    render(<ErrorState />, { wrapper: Wrapper });
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('renders custom title', () => {
    render(<ErrorState title="Failed to load routes" />, { wrapper: Wrapper });
    expect(screen.getByText('Failed to load routes')).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    render(<ErrorState description="Please check your network connection." />, {
      wrapper: Wrapper,
    });
    expect(screen.getByText('Please check your network connection.')).toBeInTheDocument();
  });

  it('does not render description when omitted', () => {
    render(<ErrorState />, { wrapper: Wrapper });
    expect(screen.queryByText('Please check your network connection.')).not.toBeInTheDocument();
  });

  it('renders correlationId via IdBadge', () => {
    const corrId = 'corr-abc123';
    render(<ErrorState correlationId={corrId} />, { wrapper: Wrapper });
    // IdBadge truncates short ids; corr-abc123 is ≤12 chars so shown as-is
    expect(screen.getByText('corr-abc123')).toBeInTheDocument();
  });

  it('does not render correlationId section when omitted', () => {
    render(<ErrorState />, { wrapper: Wrapper });
    expect(screen.queryByText('Correlation ID:')).not.toBeInTheDocument();
  });

  it('renders retry button when provided', () => {
    const retry = vi.fn();
    render(<ErrorState retry={retry} />, { wrapper: Wrapper });
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('calls retry when button is clicked', async () => {
    const retry = vi.fn();
    const user = userEvent.setup();
    render(<ErrorState retry={retry} />, { wrapper: Wrapper });
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('does not render retry button when omitted', () => {
    render(<ErrorState />, { wrapper: Wrapper });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
