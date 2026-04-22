import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import { EmptyState } from './index';

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MantineProvider>{children}</MantineProvider>;
}

describe('EmptyState', () => {
  it('renders title', () => {
    render(<EmptyState icon={IconSearch} title="No results" />, { wrapper: Wrapper });
    expect(screen.getByText('No results')).toBeInTheDocument();
  });

  it('renders optional description', () => {
    render(
      <EmptyState icon={IconSearch} title="No results" description="Try a different search." />,
      { wrapper: Wrapper },
    );
    expect(screen.getByText('Try a different search.')).toBeInTheDocument();
  });

  it('does not render description when omitted', () => {
    render(<EmptyState icon={IconSearch} title="No results" />, { wrapper: Wrapper });
    // Only title text node — no paragraph text
    expect(screen.queryByText('Try a different search.')).not.toBeInTheDocument();
  });

  it('renders action button when provided', () => {
    const onClick = vi.fn();
    render(
      <EmptyState icon={IconSearch} title="No results" action={{ label: 'Add item', onClick }} />,
      { wrapper: Wrapper },
    );
    expect(screen.getByRole('button', { name: 'Add item' })).toBeInTheDocument();
  });

  it('calls action.onClick when button is clicked', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <EmptyState icon={IconSearch} title="No results" action={{ label: 'Add item', onClick }} />,
      { wrapper: Wrapper },
    );
    await user.click(screen.getByRole('button', { name: 'Add item' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not render a button when action is omitted', () => {
    render(<EmptyState icon={IconSearch} title="No results" />, { wrapper: Wrapper });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
