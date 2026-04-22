/**
 * Deterministic counter-based ID factory.
 * IDs are human-readable (`user-0001`, `tenant-0002`, …) and stable across re-runs
 * so test snapshots and seed data are reproducible.
 *
 * Usage:
 *   const nextUserId = makeIdFactory('user');
 *   nextUserId(); // 'user-0001'
 *   nextUserId(); // 'user-0002'
 */
export function makeIdFactory(prefix: string): () => string {
  let counter = 0;
  return (): string => {
    counter += 1;
    return `${prefix}-${String(counter).padStart(4, '0')}`;
  };
}

/**
 * Reset a factory by creating a new one with the same prefix.
 * Primarily useful in tests that need a clean counter.
 */
export function resetFactory(prefix: string): () => string {
  return makeIdFactory(prefix);
}
