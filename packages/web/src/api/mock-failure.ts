/**
 * Deterministic hash-based failure simulation.
 *
 * Given the same input key, `shouldMockFail` always returns the same result.
 * This makes mock mutations predictably fail/succeed across re-renders without
 * random noise disturbing UI snapshot tests.
 *
 * Default failure rate: 2% (1 in 50 distinct keys).
 *
 * No integration with the store — called by the mock API layer (Batch C2).
 */

/**
 * djb2-style 32-bit hash over the characters of a string.
 * Produces a signed integer; take Math.abs before use.
 */
function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
     
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return h;
}

/**
 * Returns `true` if the given key should produce a simulated failure at the
 * given rate. The same key always returns the same result (deterministic).
 *
 * @param key  - Arbitrary string identifying the request (e.g. JSON args).
 * @param rate - Failure probability in [0, 1]. Default 0.02 (2%).
 */
export function shouldMockFail(key: string, rate = 0.02): boolean {
  const bucket = Math.abs(hashString(key)) % 10_000;
  return bucket < Math.round(rate * 10_000);
}
