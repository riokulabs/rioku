/**
 * Route-level permission guard helper (stub).
 *
 * Plan 1d replaces this stub: look up the user's effective permissions
 * and throw a redirect to /access-denied if any required permission is missing.
 *
 * Returns a TanStack Router `beforeLoad` function that is currently a no-op.
 * The generic return type avoids tight coupling to internal TanStack Router
 * types that are not part of the public API surface in v1.
 */
export function requirePermissions(_required: string[]) {
  // Stage-1 stub — always allows navigation.
  return () => true;
}
