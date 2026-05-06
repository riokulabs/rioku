/**
 * Access Policies API — Stage 2 stub.
 *
 * BLOCKED: The `access_policies` resource is NOT present in the daemon's
 * OpenAPI spec (`packages/proto/gen/openapi/rioku/v1/api.full.json`). Orval
 * therefore generates no typed hooks or MSW handlers for this resource.
 *
 * See decisions-needed.md § Item 002 for full tracking.
 *
 * Note: Route-level policy attach/detach (POST/DELETE
 * /api/v1/t/{tenant}/routes/{id}/policies/{policyId}) IS present in the spec
 * and is already wired in `features/routes/api.stage2.ts`. What is missing
 * here is the CRUD surface for managing access policies themselves:
 *   GET    /api/v1/t/{tenant}/policies
 *   POST   /api/v1/t/{tenant}/policies
 *   GET    /api/v1/t/{tenant}/policies/{id}
 *   PATCH  /api/v1/t/{tenant}/policies/{id}
 *   DELETE /api/v1/t/{tenant}/policies/{id}
 *   POST   /api/v1/t/{tenant}/policies/{id}/evaluate  (Decision 004)
 *
 * When those endpoints are added to the proto and regenerated via Orval:
 * 1. Create `adapter.ts` (V1Policy ↔ AccessPolicy bridge; CEL expression
 *    field will need special handling — see Decision 004).
 * 2. Replace the re-exports below with Orval-backed hook wrappers.
 * 3. Delete this comment block and the pass-through re-exports.
 */

export {
  useAccessPolicyList,
  useAccessPolicy,
  createAccessPolicyMutation,
  updateAccessPolicyMutation,
  deleteAccessPolicyMutation,
} from './api';
