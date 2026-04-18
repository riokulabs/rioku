import { describe, it, expect } from 'vitest';
import { shouldMockFail } from './mock-failure';

describe('shouldMockFail', () => {
  it('is deterministic — same key always returns the same result', () => {
    const key = 'user.create:{"email":"alice@acme.com"}';
    const first = shouldMockFail(key);
    const second = shouldMockFail(key);
    const third = shouldMockFail(key);
    expect(first).toBe(second);
    expect(second).toBe(third);
  });

  it('different keys can produce different outcomes', () => {
    // Use rate=0.5 so we definitely get both true and false without needing
    // a large sample (at 2% rate, 200 samples is borderline flaky).
    const results = new Set<boolean>();
    for (let i = 0; i < 50; i++) {
      results.add(shouldMockFail(`key-${String(i)}`, 0.5));
    }
    expect(results.has(false)).toBe(true);
    expect(results.has(true)).toBe(true);
  });

  it('returns a boolean', () => {
    expect(typeof shouldMockFail('any-key')).toBe('boolean');
  });

  it('rate=0 never fails', () => {
    for (let i = 0; i < 100; i++) {
      expect(shouldMockFail(`key-${String(i)}`, 0)).toBe(false);
    }
  });

  it('rate=1 always fails', () => {
    for (let i = 0; i < 100; i++) {
      expect(shouldMockFail(`key-${String(i)}`, 1)).toBe(true);
    }
  });

  it('default rate ~2% produces failures in expected range over large sample', () => {
    let failCount = 0;
    const total = 10_000;
    for (let i = 0; i < total; i++) {
      if (shouldMockFail(`sample-key-${String(i)}`)) failCount++;
    }
    const rate = failCount / total;
    // Allow generous range: 0.5%–5% to avoid flakiness while confirming it's not 0 or 100%
    expect(rate).toBeGreaterThan(0.005);
    expect(rate).toBeLessThan(0.05);
  });

  it('is not affected by call order — calling multiple times does not change result', () => {
    const key = 'stable-key-xyz';
    const r1 = shouldMockFail(key, 0.5);
    shouldMockFail('other-key-1', 0.5);
    shouldMockFail('other-key-2', 0.5);
    const r2 = shouldMockFail(key, 0.5);
    expect(r1).toBe(r2);
  });
});
