// Aggregator. Re-exports the canonical store + per-feature slices.
// Each parallel plan owns one slice file in this directory and one line below.
export * from './_internal';
// Plan 01 (auth-bootstrap) feature slices retired — store lives in _internal.ts
// Plan 02 (identity)
export * from './roles';
export * from './api-keys';
export * from './rbac-policies';
export * from './impersonation';
export * from './access-policies';
// Plan 03 (api-mgmt) feature slices retired — store lives in _internal.ts
// Plan 04 (ai) feature slices retired — store lives in _internal.ts
// Plan 05 (audit) feature slices retired — store lives in _internal.ts
// Plan 06 (notifications)
export * from './notifications';
export * from './notification-channels';
export * from './notification-routing';
export * from './notification-log';
// Plan 07 (settings) feature slice retired — store lives in _internal.ts
// Plan 08 (dashboards) feature slices retired — store lives in _internal.ts
// Plan 09 (plugins) feature slices retired — store lives in _internal.ts
// Plan 10 (cluster) feature slice retired — store lives in _internal.ts
// Plan 11 (super-admin) — stub retired; feature slice lives in _internal.ts
