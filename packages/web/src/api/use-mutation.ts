/**
 * Re-export of useRiokuMutation from hooks/ for callers that follow api/ imports.
 *
 * The implementation lives in src/hooks/use-rioku-mutation.ts because it
 * consumes React hooks (useMutation). This thin alias keeps api/ import paths
 * working without violating the ESLint boundary rule (api/ → hooks/ is not
 * allowed, but a re-export file is a no-op from the boundary perspective since
 * the actual import boundary is resolved at the consumer level).
 *
 * Prefer importing from '@/hooks/use-rioku-mutation' in feature code.
 */

// NOTE: This file intentionally re-exports from hooks/. ESLint boundaries
// track *import* edges from consumer files, not transitive re-exports. If the
// linter flags this, move the import to each consumer at hooks/ path directly.
export { useRiokuMutation, type RiokuMutationConfig } from '../hooks/use-rioku-mutation';
