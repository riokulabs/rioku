import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { simulateLatency } from './mock-latency';

describe('simulateLatency', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves for query kind without hanging', async () => {
    const promise = simulateLatency('query');
    // Advance well past max query latency (400 ms)
    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toBeUndefined();
  });

  it('resolves for mutation kind without hanging', async () => {
    const promise = simulateLatency('mutation');
    // Advance well past max mutation latency (800 ms)
    await vi.advanceTimersByTimeAsync(2000);
    await expect(promise).resolves.toBeUndefined();
  });

  it('query delay is within [200, 400] ms range', async () => {
    // Capture setTimeout argument to verify the delay falls in range.
    let capturedMs = 0;
    vi.spyOn(globalThis, 'setTimeout').mockImplementationOnce((fn, ms) => {
      capturedMs = ms ?? 0;
      // fn is TimerHandler which includes string; cast to function to avoid no-implied-eval
      if (typeof fn === 'function') setTimeout(fn, 0);
      return 0;
    });

    const promise = simulateLatency('query');
    await vi.runAllTimersAsync();
    await promise;

    expect(capturedMs).toBeGreaterThanOrEqual(200);
    expect(capturedMs).toBeLessThanOrEqual(400);
  });

  it('mutation delay is within [400, 800] ms range', async () => {
    let capturedMs = 0;
    vi.spyOn(globalThis, 'setTimeout').mockImplementationOnce((fn, ms) => {
      capturedMs = ms ?? 0;
      if (typeof fn === 'function') setTimeout(fn, 0);
      return 0;
    });

    const promise = simulateLatency('mutation');
    await vi.runAllTimersAsync();
    await promise;

    expect(capturedMs).toBeGreaterThanOrEqual(400);
    expect(capturedMs).toBeLessThanOrEqual(800);
  });
});
