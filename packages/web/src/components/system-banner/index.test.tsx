import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { SystemBanner } from './index';

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MantineProvider>{children}</MantineProvider>;
}

describe('SystemBanner', () => {
  it('renders title and description', () => {
    render(
      <SystemBanner tone="info" title="System Notice" description="Maintenance at midnight." />,
      { wrapper: Wrapper },
    );
    expect(screen.getByText('System Notice')).toBeInTheDocument();
    expect(screen.getByText('Maintenance at midnight.')).toBeInTheDocument();
  });

  it('fires onDismiss when dismiss button is clicked', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(
      <SystemBanner tone="warning" description="Dismiss me." dismissible onDismiss={onDismiss} />,
      { wrapper: Wrapper },
    );
    const closeBtn = screen.getByRole('button', { name: /dismiss/i });
    await user.click(closeBtn);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('fires action.onClick when action button is clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <SystemBanner
        tone="critical"
        description="Something went wrong."
        action={{ label: 'Retry', onClick }}
      />,
      { wrapper: Wrapper },
    );
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('sets data-tone="info" on the alert root', () => {
    const { container } = render(<SystemBanner tone="info" description="Info message." />, {
      wrapper: Wrapper,
    });
    const alert = container.querySelector('[data-tone="info"]');
    expect(alert).toBeInTheDocument();
  });

  it('sets data-tone="warning" on the alert root', () => {
    const { container } = render(<SystemBanner tone="warning" description="Warning." />, {
      wrapper: Wrapper,
    });
    expect(container.querySelector('[data-tone="warning"]')).toBeInTheDocument();
  });

  it('sets data-tone="critical" on the alert root', () => {
    const { container } = render(<SystemBanner tone="critical" description="Critical." />, {
      wrapper: Wrapper,
    });
    expect(container.querySelector('[data-tone="critical"]')).toBeInTheDocument();
  });

  it('sets data-tone="success" on the alert root', () => {
    const { container } = render(<SystemBanner tone="success" description="Success." />, {
      wrapper: Wrapper,
    });
    expect(container.querySelector('[data-tone="success"]')).toBeInTheDocument();
  });
});
