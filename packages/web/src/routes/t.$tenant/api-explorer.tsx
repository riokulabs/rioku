/**
 * API explorer — /t/$tenant/api-explorer
 *
 * Renders the merged stage-1 OpenAPI snapshot via Scalar. Scalar is heavy
 * (~400KB gzipped plus its Vue runtime) so the feature module is lazy-loaded
 * via `lazyRouteComponent` — it lands in its own `scalar` chunk (see the
 * `manualChunks` config in vite.config.ts) and only downloads when a user
 * actually visits this route.
 *
 * Permission guard: `service:read`. The explorer surfaces the admin REST
 * API; anyone who can read services already has the knowledge to use it.
 */
import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import { requirePermissions } from '@/hooks/use-before-load';

export const Route = createFileRoute('/t/$tenant/api-explorer')({
  beforeLoad: requirePermissions({ required: ['service:read'] }),
  component: lazyRouteComponent(() => import('@/features/api-explorer'), 'ApiExplorer'),
});
