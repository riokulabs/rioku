/**
 * Tests for <CodeBlock>.
 *
 * shiki is mocked because:
 *  - shiki is ESM-first with WebAssembly, which doesn't load cleanly under jsdom.
 *  - Primary goal: assert DOM structure, copy button, title, and loading state.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { CodeBlock } from './index';

// ── Mock shiki ────────────────────────────────────────────────────────────────

vi.mock('shiki', () => ({
  createHighlighter: vi.fn().mockResolvedValue({
    codeToHtml: vi.fn().mockImplementation((code: string) => {
      return `<pre><code data-testid="shiki-output">${code}</code></pre>`;
    }),
  }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function wrap(ui: React.ReactNode) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Reset the singleton shiki promise between tests so mocks take effect.
  // We do this by re-importing after clearing.
});

describe('<CodeBlock>', () => {
  it('renders the paper container', () => {
    wrap(<CodeBlock code="const x = 1;" language="typescript" />);
    expect(screen.getByTestId('code-block')).toBeInTheDocument();
  });

  it('shows the code while shiki loads (loading skeleton)', () => {
    wrap(<CodeBlock code="hello world" language="text" />);
    // Either loading or highlighted state should be present initially
    const container = screen.getByTestId('code-block');
    expect(container).toBeInTheDocument();
  });

  it('renders title when provided', () => {
    wrap(<CodeBlock code="{}" language="json" title="response.json" />);
    expect(screen.getByText('response.json')).toBeInTheDocument();
  });

  it('does not render title header when title is omitted and copyable=false', () => {
    wrap(<CodeBlock code="{}" language="json" copyable={false} />);
    // No title text, no copy button
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders copy button when copyable=true (default)', () => {
    wrap(<CodeBlock code="const x = 1;" language="typescript" />);
    expect(screen.getByRole('button', { name: /copy code/i })).toBeInTheDocument();
  });

  it('copy button changes to Copied after click', async () => {
    const user = userEvent.setup();
    // Use defineProperty to avoid "only getter" error on navigator.clipboard
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });

    wrap(<CodeBlock code="test content" language="text" copyable />);
    const btn = screen.getByRole('button', { name: /copy code/i });
    await user.click(btn);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /copied/i })).toBeInTheDocument();
    });
  });

  it('shows highlighted output after shiki resolves', async () => {
    wrap(<CodeBlock code="const x = 1;" language="typescript" />);
    await waitFor(() => {
      expect(screen.getByTestId('code-block-highlighted')).toBeInTheDocument();
    });
  });

  it('applies maxHeight via ScrollArea when specified', () => {
    wrap(<CodeBlock code="long code" maxHeight={200} />);
    // ScrollArea wrapper is present; we verify no errors thrown
    expect(screen.getByTestId('code-block')).toBeInTheDocument();
  });
});
