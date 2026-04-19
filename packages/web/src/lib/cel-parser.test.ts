import { describe, it, expect } from 'vitest';
import { loadCel, parseCel } from './cel-parser';

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Reset the lazy-load cache between tests so each suite starts fresh.
// We reach into the module internals via a re-import trick using vitest's
// module isolation — instead we simply rely on the memoisation being
// transparent: the same promise must be returned on repeated calls.

// ─── loadCel ─────────────────────────────────────────────────────────────────

describe('loadCel', () => {
  it('returns a Promise', () => {
    const p = loadCel();
    expect(p).toBeInstanceOf(Promise);
  });

  it('returns the exact same promise on repeated calls (memoised)', () => {
    const p1 = loadCel();
    const p2 = loadCel();
    expect(p1).toBe(p2);
  });

  it('resolves to the cel-js module with a parse function', async () => {
    const cel = await loadCel();
    expect(typeof cel.parse).toBe('function');
  });
});

// ─── parseCel ─────────────────────────────────────────────────────────────────

describe('parseCel', () => {
  it('returns ok for a simple boolean literal', async () => {
    const result = await parseCel('true');
    expect(result.ok).toBe(true);
  });

  it('returns ok for a comparison expression', async () => {
    const result = await parseCel('resource.tenant == user.tenant');
    expect(result.ok).toBe(true);
  });

  it('returns ok for a complex CEL expression', async () => {
    const result = await parseCel('resource.owner == user.id && user.role in ["admin", "super"]');
    expect(result.ok).toBe(true);
  });

  it('returns not-ok for a truncated expression with trailing operator', async () => {
    const result = await parseCel('resource.tenant ==');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  it('returns not-ok for an empty string', async () => {
    const result = await parseCel('');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/empty/i);
    }
  });

  it('returns not-ok for a whitespace-only string', async () => {
    const result = await parseCel('   ');
    expect(result.ok).toBe(false);
  });

  it('returns not-ok for an expression with mismatched parentheses', async () => {
    const result = await parseCel('(foo && bar');
    expect(result.ok).toBe(false);
  });

  it('ok result carries no error field', async () => {
    const result = await parseCel('true');
    expect('error' in result).toBe(false);
  });

  it('error result carries a non-empty error string', async () => {
    const result = await parseCel('resource.tenant ==');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(typeof result.error).toBe('string');
      expect(result.error.length).toBeGreaterThan(0);
    }
  });
});
