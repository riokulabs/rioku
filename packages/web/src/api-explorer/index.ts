/**
 * Static OpenAPI 3 snapshot served to the Scalar renderer.
 *
 * Produced by `scripts/merge-openapi.mjs` from the buf-emitted swagger 2.0
 * files in `packages/proto/gen/openapi/rioku/v1/`. Regenerate when proto
 * definitions change.
 *
 * The JSON import is intentionally typed as `unknown` then narrowed — Scalar's
 * `AnyApiReferenceConfiguration.content` accepts `object | string`, so we
 * avoid pulling in the full zod-inferred config shape here.
 */
import specJson from './openapi-merged.json';

export const openapiSpec: Record<string, unknown> = specJson as Record<string, unknown>;
