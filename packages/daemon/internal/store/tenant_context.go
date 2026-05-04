// Package store: tenant context propagation (stage-2).
//
// Storage methods on tenant-scoped tables apply `WHERE tenant_id = ?`
// filters by reading the tenant from the request context. Handlers
// resolve `/api/v1/t/{slug}/...` once and call WithTenantID to attach
// the resolved id; storage code calls TenantIDFromContext to retrieve
// it. When no tenant is attached (CLI, gRPC during bootstrap, legacy
// internal callers) the default tenant id is returned so existing
// flows keep working.
package store

import "context"

// DefaultTenantID is the seed-time identity of the bootstrap tenant.
// Migration 13 inserts this row; migration 22 backfills every legacy
// row with this value as the column default.
const DefaultTenantID = "tenant_default"

// tenantIDCtxKey is the typed key used to attach the active tenant id
// to a context.Context.
type tenantIDCtxKey struct{}

// WithTenantID returns a derived context that carries the given tenant id.
// Pass an empty string to clear the value (useful for super-admin paths
// that operate cross-tenant).
func WithTenantID(ctx context.Context, tenantID string) context.Context {
	return context.WithValue(ctx, tenantIDCtxKey{}, tenantID)
}

// TenantIDFromContext returns the active tenant id, or DefaultTenantID
// when none has been attached. The default fallback is intentional —
// every tenant-scoped table has a `tenant_id` column with this value
// as the SQL default, so callers that haven't been migrated to the
// stage-2 tenant-aware paths still hit the bootstrap tenant rather
// than mixing rows across tenants.
func TenantIDFromContext(ctx context.Context) string {
	if v, ok := ctx.Value(tenantIDCtxKey{}).(string); ok && v != "" {
		return v
	}
	return DefaultTenantID
}
