/**
 * api-explorer feature — barrel export. Re-exports the Scalar-backed
 * component; the static OpenAPI JSON lives at `@/api-explorer` (not here)
 * because assets/data are kept out of feature modules by the boundary rules.
 */
export { ApiExplorer } from './components/explorer';
