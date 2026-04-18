import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { IdBadge } from './index';

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MantineProvider>{children}</MantineProvider>;
}

const TEST_ID = 'abcdef1234567890';

describe('IdBadge', () => {
  it('renders truncated display when no label', () => {
    render(<IdBadge id={TEST_ID} />, { wrapper: Wrapper });
    // truncated: first 6 + … + last 4
    expect(screen.getByText('abcdef…7890')).toBeInTheDocument();
  });

  it('renders custom label when provided', () => {
    render(<IdBadge id={TEST_ID} label="My Service" />, { wrapper: Wrapper });
    expect(screen.getByText('My Service')).toBeInTheDocument();
  });

  it('has an accessible copy button', () => {
    render(<IdBadge id={TEST_ID} />, { wrapper: Wrapper });
    const btn = screen.getByRole('button', { name: 'Copy ID' });
    expect(btn).toBeInTheDocument();
  });

  it('shows full id when short (≤12 chars)', () => {
    const shortId = 'abc123';
    render(<IdBadge id={shortId} />, { wrapper: Wrapper });
    expect(screen.getByText('abc123')).toBeInTheDocument();
  });
});
