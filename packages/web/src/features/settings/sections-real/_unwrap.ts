/**
 * Bridge helper for the generated Orval clients.
 *
 * Orval emits response types of the shape `{ data, status, headers }` because
 * its default mutator wraps the fetch result. Our project's `customFetch`
 * mutator (see `src/api/mutator.ts`) returns the parsed JSON body directly,
 * so the runtime shape is the inner `data` payload. The generated files use
 * `// @ts-nocheck` which hides the mismatch from the type system.
 *
 * `unwrap` accepts either shape and always returns the inner payload, which
 * keeps the section components portable across:
 *   - production runtime (parsed body),
 *   - tests that stub `globalThis.fetch` to respond with the inner payload.
 *
 * If a future Orval upgrade changes the wrapping, this helper is the only
 * place that needs to learn the new shape.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function unwrap<T>(input: unknown): T | undefined {
  if (input === undefined || input === null) return undefined;
  if (typeof input === 'object' && 'data' in input) {
    const wrapper = input as { data?: unknown; status?: unknown };
    if (
      Object.prototype.hasOwnProperty.call(wrapper, 'status') &&
      typeof wrapper.data === 'object' &&
      wrapper.data !== null
    ) {
      return wrapper.data as T;
    }
  }
  return input as T;
}
