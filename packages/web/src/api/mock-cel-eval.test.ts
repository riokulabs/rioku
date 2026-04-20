/**
 * Tests for mockCelEvaluate.
 *
 * simulateLatency is mocked to avoid 400–800ms waits per test.
 * parseCel is mocked for deterministic parse outcomes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks (hoisted before imports) ────────────────────────────────────────────

vi.mock('./mock-latency', () => ({
  simulateLatency: vi.fn().mockResolvedValue(undefined),
}));

const mockParseCel = vi.fn<(...args: unknown[]) => unknown>();
vi.mock('../lib/cel-parser', () => ({
   
  parseCel: (...args: unknown[]) => mockParseCel(...args),
}));

// Import AFTER mocks
import { mockCelEvaluate } from './mock-cel-eval';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('mockCelEvaluate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockParseCel.mockResolvedValue({ ok: true });
  });

  it('returns ok:true with value:true for literal "true"', async () => {
    const result = await mockCelEvaluate('true', {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(true);
      expect(typeof result.elapsed_ms).toBe('number');
    }
  });

  it('returns ok:true with value:false for literal "false"', async () => {
    const result = await mockCelEvaluate('false', {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(false);
    }
  });

  it('returns ok:false with error message for bad syntax', async () => {
    mockParseCel.mockResolvedValue({ ok: false, error: 'Unexpected token at col 1' });
    const result = await mockCelEvaluate('???', {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('Unexpected token at col 1');
    }
  });

  it('returns ok:true for a valid non-trivial expression', async () => {
    mockParseCel.mockResolvedValue({ ok: true });
    const result = await mockCelEvaluate("request.method == 'GET'", {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.value).toBe('boolean');
    }
  });

  it('is deterministic — same expression+context always returns same value', async () => {
    mockParseCel.mockResolvedValue({ ok: true });
    const expr = "user.role == 'admin'";
    const ctx = { user: { role: 'admin' } };

    const results = await Promise.all([
      mockCelEvaluate(expr, ctx),
      mockCelEvaluate(expr, ctx),
      mockCelEvaluate(expr, ctx),
    ]);

    const values = results.map((r) => (r.ok ? r.value : null));
    expect(values[0]).toBe(values[1]);
    expect(values[1]).toBe(values[2]);
  });

  it('returns different values for different expressions', async () => {
    mockParseCel.mockResolvedValue({ ok: true });

    // These expressions hash to different buckets — collect a sample and
    // verify we see both true and false across the set (not all the same).
    const expressions = [
      'a == 1',
      'b == 2',
      'c == 3',
      'd == 4',
      'e == 5',
      'f == 6',
      'g == 7',
      'h == 8',
      'i == 9',
      'j == 10',
    ];

    const results = await Promise.all(
      expressions.map((expr) => mockCelEvaluate(expr, {})),
    );

    const values = results.map((r) => (r.ok ? r.value : null));
    // With 10 samples and 70/30 split, we expect at least one false
    const hasTrue = values.some((v) => v === true);
    const hasFalse = values.some((v) => v === false);
    expect(hasTrue).toBe(true);
    expect(hasFalse).toBe(true);
  });

  it('does not call parseCel for literal "true"', async () => {
    await mockCelEvaluate('true', {});
    expect(mockParseCel).not.toHaveBeenCalled();
  });

  it('does not call parseCel for literal "false"', async () => {
    await mockCelEvaluate('false', {});
    expect(mockParseCel).not.toHaveBeenCalled();
  });
});
