/**
 * AI-shared helpers — pure formatters + math utilities.
 *
 * Cross-used by AI Providers, Agents, Tools, Tool-routing, Rate-limits,
 * Traces, and MCP Servers. No Mantine imports; presentation components live
 * alongside in `badges.tsx`.
 */
import type { AiTrace } from '@/api/resources';

/**
 * Format a USD cost value with millicent precision.
 *
 * Values < $0.01 use 4 decimals (e.g. "$0.0032").
 * Values ≥ $0.01 use 2 decimals (e.g. "$1.25", "$42.00").
 */
export function formatCost(usd: number): string {
  if (!Number.isFinite(usd)) return '$0.00';
  if (usd === 0) return '$0.00';
  if (Math.abs(usd) < 0.01) {
    return `$${usd.toFixed(4)}`;
  }
  return `$${usd.toFixed(2)}`;
}

/**
 * Format a token count with k/M suffixes for readability.
 *
 *   formatTokens(850)      → "850"
 *   formatTokens(1234)     → "1.2k"
 *   formatTokens(2_500_000)→ "2.5M"
 */
export function formatTokens(count: number): string {
  if (!Number.isFinite(count) || count < 0) return '0';
  if (count < 1000) return String(Math.round(count));
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

/**
 * Shorten a prompt/completion string to a maximum character count,
 * appending an ellipsis when truncated. No word-boundary logic —
 * this is for preview cells in the trace list.
 */
export function shortenPrompt(text: string, maxChars = 120): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trimEnd()}…`;
}

/**
 * Compute total tokens consumed by a trace (input + output).
 * Tool-call tokens are NOT included — the daemon does not bill them separately.
 */
export function computeTraceTotalTokens(trace: AiTrace): number {
  return trace.input_tokens + trace.output_tokens;
}
