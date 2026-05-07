// Aggregator. Re-exports the canonical seed function + per-feature slices.
// Each parallel plan owns one slice file in this directory and one line below.
export * from './_internal';
// Plan 01 (auth-bootstrap) feature slices retired — seed lives in _internal.ts
// Plan 02 (identity) feature slices retired — seed lives in _internal.ts
// Plan 03 (api-mgmt) feature slices retired — seed lives in _internal.ts
// Plan 04 (ai) feature slices retired — seed lives in _internal.ts
// Plan 05 (audit) feature slices retired — seed lives in _internal.ts
// Plan 06 (notifications) feature slices retired — seed lives in _internal.ts
// Plan 07 (settings) feature slice retired — seed lives in _internal.ts
// Plan 08 (dashboards) feature slices retired — seed lives in _internal.ts
// Plan 09 (plugins) feature slices retired — seed lives in _internal.ts
// Plan 10 (cluster) feature slice retired — seed lives in _internal.ts
// Plan 11 (super-admin) — stub retired; feature slice lives in _internal.ts
