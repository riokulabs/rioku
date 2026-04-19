/**
 * Mock daemon CEL evaluator — stage 1.
 *
 * Provides a simulated `evaluate()` endpoint for the policy-editor preview.
 * Stage 1 deliberately does NOT perform real CEL evaluation — it:
 *   1. Returns the literal result for the trivial expressions `true` / `false`
 *   2. Runs parse-only validation via `parseCel()` and returns an error if the
 *      expression is syntactically invalid.
 *   3. For all other valid expressions, returns a fake-but-plausible boolean
 *      result: 70% `true`, 30% `false`, determined deterministically by a
 *      simple hash of `expression + JSON.stringify(context)` so that repeated
 *      calls with the same inputs always return the same value.
 *
 * Stage 2 will replace this with a real daemon gRPC call.
 *
 * spec §7.2 / Task 1d.65
 */

import { parseCel } from '../lib/cel-parser';
import { simulateLatency } from './mock-latency';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CelEvalResult =
  | { ok: true; value: unknown; elapsed_ms: number }
  | { ok: false; error: string };

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Simple djb2-style string hash — deterministic, not cryptographic.
 * Returns a non-negative 32-bit integer.
 */
function djb2Hash(s: string): number {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash + s.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/**
 * Derive a deterministic boolean for a given expression + context.
 * 70% probability of `true` based on hash mod 10.
 */
function deterministicBool(expression: string, context: unknown): boolean {
  const seed = `${expression}${JSON.stringify(context)}`;
  const h = djb2Hash(seed);
  // 0–6 → true (70%), 7–9 → false (30%)
  return h % 10 < 7;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Simulate a daemon CEL evaluation request.
 *
 * @param expression - The CEL source string to "evaluate"
 * @param context    - The evaluation context (arbitrary JSON-serialisable value)
 * @returns          - A CelEvalResult promise
 */
export async function mockCelEvaluate(
  expression: string,
  context: unknown,
): Promise<CelEvalResult> {
  const start = performance.now();

  // Simulate realistic mutation latency
  await simulateLatency('mutation');

  // Trivial literal cases
  if (expression.trim() === 'true') {
    return { ok: true, value: true, elapsed_ms: performance.now() - start };
  }
  if (expression.trim() === 'false') {
    return { ok: true, value: false, elapsed_ms: performance.now() - start };
  }

  // Parse-only validation for all other expressions
  const parseResult = await parseCel(expression);

  if (!parseResult.ok) {
    return { ok: false, error: parseResult.error };
  }

  // Valid but non-trivial: return a deterministic fake result
  const value = deterministicBool(expression, context);
  return { ok: true, value, elapsed_ms: performance.now() - start };
}
