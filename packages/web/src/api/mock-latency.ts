/**
 * Simulates realistic network latency for mock API responses.
 *
 * Ranges match a plausible internal gateway:
 *   queries  → 200–400 ms  (fast reads)
 *   mutations → 400–800 ms  (writes with validation)
 *
 * No integration with the store — called by the mock API layer (Batch C2).
 */
export async function simulateLatency(kind: 'query' | 'mutation'): Promise<void> {
  const [min, max] = kind === 'query' ? [200, 400] : [400, 800];
  const ms = min + Math.random() * (max - min);
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
