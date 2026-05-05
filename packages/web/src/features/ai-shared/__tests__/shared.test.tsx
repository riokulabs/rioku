/**
 * Tests for the shared AI helpers + atomic badge components.
 */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import {
  ProviderKindBadge,
  ToolKindBadge,
  McpHealthChip,
  DangerousToolBadge,
  formatCost,
  formatTokens,
  shortenPrompt,
  computeTraceTotalTokens,
} from '..';
import type { AiTrace } from '@/api/resources';

describe('formatCost', () => {
  it('formats zero as $0.00', () => {
    expect(formatCost(0)).toBe('$0.00');
  });

  it('uses 4 decimals below one cent', () => {
    expect(formatCost(0.0032)).toBe('$0.0032');
    expect(formatCost(0.00001)).toBe('$0.0000');
  });

  it('uses 2 decimals at or above one cent', () => {
    expect(formatCost(0.01)).toBe('$0.01');
    expect(formatCost(1.25)).toBe('$1.25');
    expect(formatCost(42)).toBe('$42.00');
  });

  it('handles non-finite input', () => {
    expect(formatCost(Number.NaN)).toBe('$0.00');
    expect(formatCost(Number.POSITIVE_INFINITY)).toBe('$0.00');
  });
});

describe('formatTokens', () => {
  it('returns whole number under 1000', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(850)).toBe('850');
    expect(formatTokens(999)).toBe('999');
  });

  it('uses k suffix for thousands', () => {
    expect(formatTokens(1234)).toBe('1.2k');
    expect(formatTokens(10_000)).toBe('10.0k');
  });

  it('uses M suffix for millions', () => {
    expect(formatTokens(1_500_000)).toBe('1.5M');
    expect(formatTokens(2_500_000)).toBe('2.5M');
  });

  it('clamps negatives to 0', () => {
    expect(formatTokens(-5)).toBe('0');
    expect(formatTokens(Number.NaN)).toBe('0');
  });
});

describe('shortenPrompt', () => {
  it('returns input unchanged when within limit', () => {
    expect(shortenPrompt('hello world', 120)).toBe('hello world');
  });

  it('truncates with ellipsis when exceeding limit', () => {
    const long = 'a'.repeat(200);
    const out = shortenPrompt(long, 50);
    expect(out).toHaveLength(51); // 50 chars + …
    expect(out.endsWith('…')).toBe(true);
  });

  it('uses default max of 120 chars', () => {
    const long = 'b'.repeat(200);
    const out = shortenPrompt(long);
    expect(out.length).toBeLessThanOrEqual(121);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('computeTraceTotalTokens', () => {
  it('sums input + output tokens', () => {
    const trace = {
      input_tokens: 123,
      output_tokens: 456,
    } as AiTrace;
    expect(computeTraceTotalTokens(trace)).toBe(579);
  });
});

describe('ProviderKindBadge', () => {
  it('renders the OpenAI label', () => {
    renderWithProviders(<ProviderKindBadge kind="openai" />);
    expect(screen.getByText('OpenAI')).toBeInTheDocument();
  });

  it('renders the Anthropic label', () => {
    renderWithProviders(<ProviderKindBadge kind="anthropic" />);
    expect(screen.getByText('Anthropic')).toBeInTheDocument();
  });

  it('renders the Gemini label', () => {
    renderWithProviders(<ProviderKindBadge kind="gemini" />);
    expect(screen.getByText('Gemini')).toBeInTheDocument();
  });

  it('renders the Ollama label', () => {
    renderWithProviders(<ProviderKindBadge kind="ollama" />);
    expect(screen.getByText('Ollama')).toBeInTheDocument();
  });

  it('renders the Custom label', () => {
    renderWithProviders(<ProviderKindBadge kind="custom" />);
    expect(screen.getByText('Custom')).toBeInTheDocument();
  });
});

describe('ToolKindBadge', () => {
  it('renders native kind uppercased', () => {
    renderWithProviders(<ToolKindBadge kind="native" />);
    expect(screen.getByText('NATIVE')).toBeInTheDocument();
  });

  it('renders mcp kind uppercased', () => {
    renderWithProviders(<ToolKindBadge kind="mcp" />);
    expect(screen.getByText('MCP')).toBeInTheDocument();
  });

  it('renders http kind uppercased', () => {
    renderWithProviders(<ToolKindBadge kind="http" />);
    expect(screen.getByText('HTTP')).toBeInTheDocument();
  });
});

describe('McpHealthChip', () => {
  it.each(['healthy', 'degraded', 'unreachable', 'disabled'] as const)(
    'renders %s label',
    (status) => {
      renderWithProviders(<McpHealthChip health={status} />);
      expect(screen.getByText(status)).toBeInTheDocument();
    },
  );
});

describe('DangerousToolBadge', () => {
  it('renders the Dangerous label', () => {
    renderWithProviders(<DangerousToolBadge />);
    expect(screen.getByText('Dangerous')).toBeInTheDocument();
  });
});
