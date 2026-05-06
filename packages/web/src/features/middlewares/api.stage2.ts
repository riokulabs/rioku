/**
 * Middlewares API — Stage 2 stub.
 *
 * BLOCKED: The `middlewares` resource is NOT present in the daemon's OpenAPI
 * spec (`packages/proto/gen/openapi/rioku/v1/api.full.json`). Orval therefore
 * generates no typed hooks or MSW handlers for this resource.
 *
 * See decisions-needed.md § Item 002 for full tracking.
 *
 * This file intentionally re-exports the Stage 1 mock implementation until
 * the daemon exposes:
 *   GET    /api/v1/t/{tenant}/middlewares
 *   POST   /api/v1/t/{tenant}/middlewares
 *   GET    /api/v1/t/{tenant}/middlewares/{id}
 *   PATCH  /api/v1/t/{tenant}/middlewares/{id}
 *   DELETE /api/v1/t/{tenant}/middlewares/{id}
 *   PUT    /api/v1/t/{tenant}/routes/{routeId}/middlewares/order
 *
 * When those endpoints are added to the proto and regenerated via Orval:
 * 1. Create `adapter.ts` (V1Middleware ↔ Middleware bridge).
 * 2. Replace the re-exports below with Orval-backed hook wrappers.
 * 3. Delete this comment block and the pass-through re-exports.
 */

export {
  useMiddlewareList,
  useMiddlewareDetail,
  createMiddleware,
  updateMiddleware,
  deleteMiddleware,
} from './api';
