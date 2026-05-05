// packages/web/src/api/mutator.ts
// Placeholder. Full implementation lands in Task 3.
// Orval references this path during generation; real fetch handler comes next.
export const customFetch = async <T>(_args: {
  url: string;
  method: string;
  data?: unknown;
  signal?: AbortSignal;
}): Promise<T> => {
  throw new Error('mutator.customFetch not yet implemented (Task 3)');
};
