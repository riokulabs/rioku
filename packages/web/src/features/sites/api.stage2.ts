/**
 * Sites API — Stage 2 stub.
 *
 * BLOCKED: The `sites` resource is NOT present in the daemon's OpenAPI spec
 * (`packages/proto/gen/openapi/rioku/v1/api.full.json`). Orval therefore
 * generates no typed hooks or MSW handlers for this resource.
 *
 * See decisions-needed.md § Item 002 for full tracking.
 *
 * This file intentionally re-exports the Stage 1 mock implementation until
 * the daemon exposes:
 *   GET    /api/v1/t/{tenant}/sites
 *   POST   /api/v1/t/{tenant}/sites
 *   GET    /api/v1/t/{tenant}/sites/{id}
 *   PATCH  /api/v1/t/{tenant}/sites/{id}
 *   DELETE /api/v1/t/{tenant}/sites/{id}
 *   POST   /api/v1/t/{tenant}/sites/{id}/force-reload
 *
 * When those endpoints are added to the proto and regenerated via Orval:
 * 1. Create `adapter.ts` (V1Site ↔ Site bridge; Sites link to Services via
 *    Caddy virtual-host config, requiring special handling for the wizard's
 *    `upstream_mode` field).
 * 2. Replace the re-exports below with Orval-backed hook wrappers.
 * 3. Delete this comment block and the pass-through re-exports.
 */

export {
  useSiteList,
  useSiteDetail,
  createSite,
  updateSite,
  deleteSite,
} from './api';
