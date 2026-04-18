import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { KeyboardShortcutsHelp } from './index';

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MantineProvider>{children}</MantineProvider>;
}

describe('KeyboardShortcutsHelp', () => {
  it('does not show modal initially', () => {
    render(<KeyboardShortcutsHelp />, { wrapper: Wrapper });
    expect(screen.queryByText('Keyboard shortcuts')).not.toBeInTheDocument();
  });

  it('opens modal when ? is pressed', async () => {
    const user = userEvent.setup();
    render(<KeyboardShortcutsHelp />, { wrapper: Wrapper });
    await user.keyboard('?');
    expect(screen.getByText('Keyboard shortcuts')).toBeInTheDocument();
  });

  it('shows all expected shortcut rows when open', async () => {
    const user = userEvent.setup();
    render(<KeyboardShortcutsHelp />, { wrapper: Wrapper });
    await user.keyboard('?');
    expect(screen.getByText('Open spotlight')).toBeInTheDocument();
    expect(screen.getByText('Show this help')).toBeInTheDocument();
    expect(screen.getByText('Save form')).toBeInTheDocument();
  });

  it('closes modal when close button is clicked', async () => {
    const user = userEvent.setup();
    render(<KeyboardShortcutsHelp />, { wrapper: Wrapper });
    await user.keyboard('?');
    expect(screen.getByText('Keyboard shortcuts')).toBeInTheDocument();
    const closeBtn = screen.getByRole('button', { name: /close keyboard shortcuts/i });
    await user.click(closeBtn);
    expect(screen.queryByText('Keyboard shortcuts')).not.toBeInTheDocument();
  });
});
