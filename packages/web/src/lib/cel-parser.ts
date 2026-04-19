/**
 * Lazy-loaded CEL (Common Expression Language) parser.
 *
 * ## cel-js API shape used (v0.8.x)
 *
 * Package: `cel-js`
 * Entry:   `cel-js/dist/index.js`
 *
 * Relevant exports:
 *   - `parse(expression: string): ParseResult`
 *      where `ParseResult = Success | Failure`
 *            `Success  = { isSuccess: true;  cst: CstNode }`
 *            `Failure  = { isSuccess: false; errors: string[] }`
 *   - `CelParseError` — thrown for certain invalid inputs instead of returning
 *      a Failure. Caught below and mapped to the structured error format.
 *
 * Note: `evaluate()` is NOT used here — we perform parse-only validation,
 * deliberately avoiding evaluation to keep the surface safe for untrusted
 * CEL policy expressions entered in the admin UI.
 *
 * If cel-js is upgraded, verify that `parse()` still returns `ParseResult`
 * (not a thrown exception) and that the `isSuccess` discriminant is stable.
 */

import type { ParseResult } from 'cel-js';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Structured parse result returned by `parseCel`. */
export type CelParseResult =
  | { ok: true }
  | { ok: false; error: string; line?: number; col?: number };

// ─── Lazy loader ──────────────────────────────────────────────────────────────

/** Minimal interface of the cel-js module we actually use. */
interface CelModule {
  parse(expression: string): ParseResult;
}

let _celPromise: Promise<CelModule> | null = null;

/**
 * Load the `cel-js` module on first call; return the cached promise on
 * subsequent calls. The promise identity is stable — callers can use
 * `===` to verify they receive the same promise.
 */
export function loadCel(): Promise<CelModule> {
  _celPromise ??= import('cel-js') as Promise<CelModule>;
  return _celPromise;
}

// ─── Parser ───────────────────────────────────────────────────────────────────

/**
 * Parse a CEL expression and return a structured result.
 *
 * - Returns `{ ok: true }` for syntactically valid expressions.
 * - Returns `{ ok: false; error: string }` for parse errors or empty input.
 * - Never throws. All exceptions from cel-js are caught and mapped.
 */
export async function parseCel(source: string): Promise<CelParseResult> {
  if (!source.trim()) {
    return { ok: false, error: 'Expression must not be empty.' };
  }

  try {
    const cel = await loadCel();
    const result = cel.parse(source);

    if (result.isSuccess) {
      return { ok: true };
    }

    // Failure — errors is string[]. Return the first error message.
    const errorMessage = result.errors[0] ?? 'Parse error.';
    return { ok: false, error: errorMessage };
  } catch (err: unknown) {
    // cel-js may throw CelParseError for certain malformed inputs.
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
