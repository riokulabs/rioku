/**
 * Unit tests for <CelDiff>.
 *
 * Covers: valid-CEL side-by-side token diff, invalid-CEL fallback,
 * and the "no change" render path.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { CelDiff } from '../components/cel-diff';

function wrap(ui: React.ReactNode) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

describe('CelDiff', () => {
  it('renders a side-by-side diff for valid CEL on both sides', async () => {
    wrap(
      <CelDiff
        before="resource.owner == user.id"
        after='resource.owner == user.id && user.role == "admin"'
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('cel-diff-before')).toBeInTheDocument();
      expect(screen.getByTestId('cel-diff-after')).toBeInTheDocument();
    });
    // The "admin" literal appears only on the after side and must be
    // classified as added.
    const added = Array.from(
      screen.getByTestId('cel-diff-after').querySelectorAll('[data-token-kind="added"]'),
    );
    expect(added.length).toBeGreaterThan(0);
  });

  it('falls back to plain text when either side fails to parse', async () => {
    wrap(<CelDiff before="resource.tenant ==" after="resource.tenant == user.tenant" />);
    await waitFor(() => {
      expect(screen.getByTestId('cel-diff-fallback')).toBeInTheDocument();
    });
    expect(screen.getByText(/showing raw text/i)).toBeInTheDocument();
  });

  it('renders the (no change) note when before === after', () => {
    wrap(<CelDiff before="true" after="true" />);
    expect(screen.getByText('(no change)')).toBeInTheDocument();
  });

  it('marks removed tokens with the removed data attribute', async () => {
    wrap(
      <CelDiff
        before='resource.owner == user.id && user.role == "admin"'
        after="resource.owner == user.id"
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('cel-diff-before')).toBeInTheDocument();
    });
    const removed = Array.from(
      screen.getByTestId('cel-diff-before').querySelectorAll('[data-token-kind="removed"]'),
    );
    expect(removed.length).toBeGreaterThan(0);
  });
});
