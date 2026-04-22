/**
 * Tests for <DiffView>.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { DiffView } from './index';

function wrap(ui: React.ReactNode) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

describe('<DiffView>', () => {
  it('renders the container', () => {
    wrap(<DiffView before={{}} after={{}} />);
    expect(screen.getByTestId('diff-view')).toBeInTheDocument();
  });

  it('shows "Before" and "After" column headers', () => {
    wrap(<DiffView before={{}} after={{}} />);
    expect(screen.getByText('Before')).toBeInTheDocument();
    expect(screen.getByText('After')).toBeInTheDocument();
  });

  it('shows unchanged keys in both columns', () => {
    wrap(<DiffView before={{ name: 'Alice' }} after={{ name: 'Alice' }} />);
    // "0 changed" badge
    expect(screen.getByText('0 changed')).toBeInTheDocument();
  });

  it('highlights changed values', () => {
    wrap(<DiffView before={{ role: 'viewer' }} after={{ role: 'editor' }} />);
    expect(screen.getByText('1 changed')).toBeInTheDocument();
    // Both values rendered
    expect(screen.getAllByText(/"viewer"/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/"editor"/i).length).toBeGreaterThan(0);
  });

  it('shows added keys with "—" on the left', () => {
    wrap(<DiffView before={{}} after={{ newField: 'hello' }} />);
    expect(screen.getByText('1 changed')).toBeInTheDocument();
    // The "—" placeholder for left side
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThan(0);
  });

  it('shows removed keys with "—" on the right', () => {
    wrap(<DiffView before={{ oldField: 'bye' }} after={{}} />);
    expect(screen.getByText('1 changed')).toBeInTheDocument();
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThan(0);
  });

  it('renders a custom label', () => {
    wrap(<DiffView before={{}} after={{}} label="Role update" />);
    expect(screen.getByText('Role update')).toBeInTheDocument();
  });

  it('compact mode hides unchanged keys', () => {
    const { container } = wrap(
      <DiffView
        before={{ unchanged: 'x', changed: 'old' }}
        after={{ unchanged: 'x', changed: 'new' }}
        compact
      />,
    );
    // "unchanged" key should NOT appear
    expect(container.textContent).not.toContain('unchanged');
    // "changed" key should appear
    expect(container.textContent).toContain('changed');
  });

  it('handles nested objects', () => {
    wrap(
      <DiffView
        before={{ settings: { timeout: 30, retry: true } }}
        after={{ settings: { timeout: 60, retry: true } }}
      />,
    );
    // "settings" section header visible
    expect(screen.getAllByText(/settings:/i).length).toBeGreaterThan(0);
  });

  it('handles null / primitive before+after gracefully', () => {
    wrap(<DiffView before={null} after={{ key: 'val' }} />);
    expect(screen.getByTestId('diff-view')).toBeInTheDocument();
  });
});
