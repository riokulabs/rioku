package postgres

import (
	"context"
	"database/sql"
	"errors"
	"time"

	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"

	"github.com/riokulabs/rioku/internal/store"
)

// tx wraps *sql.Tx and implements store.Tx. All CRUD methods are stubs
// returning "not implemented" errors until filled in by subsequent phases.
type tx struct {
	sqlTx  *sql.Tx
	notify chan store.ChangeEvent
}

func (t *tx) Commit() error   { return t.sqlTx.Commit() }
func (t *tx) Rollback() error { return t.sqlTx.Rollback() }

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

func (t *tx) CreateRoute(_ context.Context, _ *riokuv1.Route) (*riokuv1.Route, error) {
	return nil, errors.New("postgres: CreateRoute not implemented")
}

func (t *tx) GetRoute(_ context.Context, _ string) (*riokuv1.Route, error) {
	return nil, errors.New("postgres: GetRoute not implemented")
}

func (t *tx) ListRoutes(_ context.Context) ([]*riokuv1.Route, error) {
	return nil, errors.New("postgres: ListRoutes not implemented")
}

func (t *tx) UpdateRoute(_ context.Context, _ *riokuv1.Route) (*riokuv1.Route, error) {
	return nil, errors.New("postgres: UpdateRoute not implemented")
}

func (t *tx) DeleteRoute(_ context.Context, _ string) error {
	return errors.New("postgres: DeleteRoute not implemented")
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

func (t *tx) CreateService(_ context.Context, _ *riokuv1.Service) (*riokuv1.Service, error) {
	return nil, errors.New("postgres: CreateService not implemented")
}

func (t *tx) GetService(_ context.Context, _ string) (*riokuv1.Service, error) {
	return nil, errors.New("postgres: GetService not implemented")
}

func (t *tx) ListServices(_ context.Context) ([]*riokuv1.Service, error) {
	return nil, errors.New("postgres: ListServices not implemented")
}

func (t *tx) UpdateService(_ context.Context, _ *riokuv1.Service) (*riokuv1.Service, error) {
	return nil, errors.New("postgres: UpdateService not implemented")
}

func (t *tx) DeleteService(_ context.Context, _ string) error {
	return errors.New("postgres: DeleteService not implemented")
}

// ---------------------------------------------------------------------------
// Policies (proto)
// ---------------------------------------------------------------------------

func (t *tx) CreatePolicy(_ context.Context, _ *riokuv1.Policy) (*riokuv1.Policy, error) {
	return nil, errors.New("postgres: CreatePolicy not implemented")
}

func (t *tx) GetPolicy(_ context.Context, _ string) (*riokuv1.Policy, error) {
	return nil, errors.New("postgres: GetPolicy not implemented")
}

func (t *tx) ListPolicies(_ context.Context) ([]*riokuv1.Policy, error) {
	return nil, errors.New("postgres: ListPolicies not implemented")
}

func (t *tx) UpdatePolicy(_ context.Context, _ *riokuv1.Policy) (*riokuv1.Policy, error) {
	return nil, errors.New("postgres: UpdatePolicy not implemented")
}

func (t *tx) DeletePolicy(_ context.Context, _ string) error {
	return errors.New("postgres: DeletePolicy not implemented")
}

// ---------------------------------------------------------------------------
// Policy bindings
// ---------------------------------------------------------------------------

func (t *tx) AttachPolicy(_ context.Context, _, _, _ string) error {
	return errors.New("postgres: AttachPolicy not implemented")
}

func (t *tx) DetachPolicy(_ context.Context, _, _, _ string) error {
	return errors.New("postgres: DetachPolicy not implemented")
}

func (t *tx) ListPoliciesByTarget(_ context.Context, _, _ string) ([]string, error) {
	return nil, errors.New("postgres: ListPoliciesByTarget not implemented")
}

// ---------------------------------------------------------------------------
// API Keys
// ---------------------------------------------------------------------------

func (t *tx) CreateAPIKey(_ context.Context, _, _ string, _ []string, _ *time.Time, _ string) (string, error) {
	return "", errors.New("postgres: CreateAPIKey not implemented")
}

func (t *tx) GetAPIKey(_ context.Context, _ string) (*store.APIKey, error) {
	return nil, errors.New("postgres: GetAPIKey not implemented")
}

func (t *tx) GetAPIKeyByHash(_ context.Context, _ string) (*store.APIKey, error) {
	return nil, errors.New("postgres: GetAPIKeyByHash not implemented")
}

func (t *tx) ListAPIKeys(_ context.Context) ([]*store.APIKey, error) {
	return nil, errors.New("postgres: ListAPIKeys not implemented")
}

func (t *tx) ListAPIKeysByOwner(_ context.Context, _ string) ([]*store.APIKey, error) {
	return nil, errors.New("postgres: ListAPIKeysByOwner not implemented")
}

func (t *tx) RevokeAPIKey(_ context.Context, _ string) error {
	return errors.New("postgres: RevokeAPIKey not implemented")
}

func (t *tx) UpdateAPIKey(_ context.Context, _ string, _ store.UpdateAPIKeyParams) (*store.APIKey, error) {
	return nil, errors.New("postgres: UpdateAPIKey not implemented")
}

func (t *tx) RecordAPIKeyUse(_ context.Context, _ string, _ time.Time) error {
	return errors.New("postgres: RecordAPIKeyUse not implemented")
}

// ---------------------------------------------------------------------------
// Config Versions
// ---------------------------------------------------------------------------

func (t *tx) SaveConfigVersion(_ context.Context, _ []byte, _ string) (int64, error) {
	return 0, errors.New("postgres: SaveConfigVersion not implemented")
}

func (t *tx) GetConfigVersion(_ context.Context, _ int64) (*store.ConfigVersion, error) {
	return nil, errors.New("postgres: GetConfigVersion not implemented")
}

func (t *tx) ListConfigVersions(_ context.Context, _ int) ([]*store.ConfigVersion, error) {
	return nil, errors.New("postgres: ListConfigVersions not implemented")
}

func (t *tx) LatestConfigVersion(_ context.Context) (int64, error) {
	return 0, errors.New("postgres: LatestConfigVersion not implemented")
}

// ---------------------------------------------------------------------------
// Audit Log
// ---------------------------------------------------------------------------

func (t *tx) AppendAuditEntry(_ context.Context, _ *riokuv1.AuditEntry) error {
	return errors.New("postgres: AppendAuditEntry not implemented")
}

func (t *tx) QueryAuditLog(_ context.Context, _ store.AuditQuery) ([]*riokuv1.AuditEntry, error) {
	return nil, errors.New("postgres: QueryAuditLog not implemented")
}

func (t *tx) CountAuditLog(_ context.Context, _ store.AuditQuery) (int, error) {
	return 0, errors.New("postgres: CountAuditLog not implemented")
}

func (t *tx) GetAuditEntry(_ context.Context, _ string) (*riokuv1.AuditEntry, error) {
	return nil, errors.New("postgres: GetAuditEntry not implemented")
}

func (t *tx) ListAuditActors(_ context.Context, _ string, _ int) ([]string, error) {
	return nil, errors.New("postgres: ListAuditActors not implemented")
}

func (t *tx) ListAuditResourceIDs(_ context.Context, _, _ string, _ int) ([]string, error) {
	return nil, errors.New("postgres: ListAuditResourceIDs not implemented")
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

func (t *tx) CreateUser(_ context.Context, _ *store.User) (*store.User, error) {
	return nil, errors.New("postgres: CreateUser not implemented")
}

func (t *tx) GetUser(_ context.Context, _ string) (*store.User, error) {
	return nil, errors.New("postgres: GetUser not implemented")
}

func (t *tx) GetUserByUsername(_ context.Context, _ string) (*store.User, error) {
	return nil, errors.New("postgres: GetUserByUsername not implemented")
}

func (t *tx) ListUsers(_ context.Context) ([]*store.User, error) {
	return nil, errors.New("postgres: ListUsers not implemented")
}

func (t *tx) UpdateUser(_ context.Context, _ *store.User) (*store.User, error) {
	return nil, errors.New("postgres: UpdateUser not implemented")
}

func (t *tx) DeleteUser(_ context.Context, _ string) error {
	return errors.New("postgres: DeleteUser not implemented")
}

func (t *tx) IncrementFailedAttempts(_ context.Context, _ string, _ *time.Time) error {
	return errors.New("postgres: IncrementFailedAttempts not implemented")
}

func (t *tx) ResetFailedAttempts(_ context.Context, _ string) error {
	return errors.New("postgres: ResetFailedAttempts not implemented")
}

func (t *tx) UpdateLastLogin(_ context.Context, _ string) error {
	return errors.New("postgres: UpdateLastLogin not implemented")
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

func (t *tx) CreateSession(_ context.Context, _ *store.Session) (*store.Session, error) {
	return nil, errors.New("postgres: CreateSession not implemented")
}

func (t *tx) GetSession(_ context.Context, _ string) (*store.Session, error) {
	return nil, errors.New("postgres: GetSession not implemented")
}

func (t *tx) ListSessionsByUser(_ context.Context, _ string) ([]*store.Session, error) {
	return nil, errors.New("postgres: ListSessionsByUser not implemented")
}

func (t *tx) DeleteSession(_ context.Context, _ string) error {
	return errors.New("postgres: DeleteSession not implemented")
}

func (t *tx) DeleteSessionsByUser(_ context.Context, _ string) error {
	return errors.New("postgres: DeleteSessionsByUser not implemented")
}

func (t *tx) DeleteSessionsByUserExcept(_ context.Context, _, _ string) error {
	return errors.New("postgres: DeleteSessionsByUserExcept not implemented")
}

func (t *tx) UpdateSessionLastActive(_ context.Context, _ string, _ time.Time) error {
	return errors.New("postgres: UpdateSessionLastActive not implemented")
}

func (t *tx) DeleteExpiredSessions(_ context.Context) (int64, error) {
	return 0, errors.New("postgres: DeleteExpiredSessions not implemented")
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

func (t *tx) CreateRole(_ context.Context, _ store.CreateRoleParams) (*store.Role, error) {
	return nil, errors.New("postgres: CreateRole not implemented")
}

func (t *tx) GetRole(_ context.Context, _ string) (*store.Role, error) {
	return nil, errors.New("postgres: GetRole not implemented")
}

func (t *tx) ListRoles(_ context.Context) ([]*store.Role, error) {
	return nil, errors.New("postgres: ListRoles not implemented")
}

func (t *tx) UpdateRole(_ context.Context, _ string, _ store.UpdateRoleParams) (*store.Role, error) {
	return nil, errors.New("postgres: UpdateRole not implemented")
}

func (t *tx) DeleteRole(_ context.Context, _ string) error {
	return errors.New("postgres: DeleteRole not implemented")
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

func (t *tx) ListPermissions(_ context.Context) ([]*store.Permission, error) {
	return nil, errors.New("postgres: ListPermissions not implemented")
}

func (t *tx) GetUserScopes(_ context.Context, _ string) ([]string, error) {
	return nil, errors.New("postgres: GetUserScopes not implemented")
}

// ---------------------------------------------------------------------------
// User Roles
// ---------------------------------------------------------------------------

func (t *tx) AssignRole(_ context.Context, _, _, _ string) error {
	return errors.New("postgres: AssignRole not implemented")
}

func (t *tx) RevokeRole(_ context.Context, _, _ string) error {
	return errors.New("postgres: RevokeRole not implemented")
}

func (t *tx) ListUserRoles(_ context.Context, _ string) ([]*store.UserRole, error) {
	return nil, errors.New("postgres: ListUserRoles not implemented")
}

func (t *tx) ListUsersWithRole(_ context.Context, _ string) ([]string, error) {
	return nil, errors.New("postgres: ListUsersWithRole not implemented")
}

// ---------------------------------------------------------------------------
// TOTP Backup Codes
// ---------------------------------------------------------------------------

func (t *tx) CreateTOTPBackupCodes(_ context.Context, _ string, _ []string) error {
	return errors.New("postgres: CreateTOTPBackupCodes not implemented")
}

func (t *tx) ListUnusedTOTPBackupCodes(_ context.Context, _ string) ([]*store.TOTPBackupCode, error) {
	return nil, errors.New("postgres: ListUnusedTOTPBackupCodes not implemented")
}

func (t *tx) MarkTOTPBackupCodeUsed(_ context.Context, _ string) error {
	return errors.New("postgres: MarkTOTPBackupCodeUsed not implemented")
}

func (t *tx) DeleteTOTPBackupCodes(_ context.Context, _ string) error {
	return errors.New("postgres: DeleteTOTPBackupCodes not implemented")
}

// ---------------------------------------------------------------------------
// Tenants
// ---------------------------------------------------------------------------

func (t *tx) CreateTenant(_ context.Context, _ *store.Tenant) (*store.Tenant, error) {
	return nil, errors.New("postgres: CreateTenant not implemented")
}

func (t *tx) GetTenant(_ context.Context, _ string) (*store.Tenant, error) {
	return nil, errors.New("postgres: GetTenant not implemented")
}

func (t *tx) GetTenantBySlug(_ context.Context, _ string) (*store.Tenant, error) {
	return nil, errors.New("postgres: GetTenantBySlug not implemented")
}

func (t *tx) ListTenants(_ context.Context) ([]*store.Tenant, error) {
	return nil, errors.New("postgres: ListTenants not implemented")
}

func (t *tx) UpdateTenant(_ context.Context, _ string, _ store.UpdateTenantParams) (*store.Tenant, error) {
	return nil, errors.New("postgres: UpdateTenant not implemented")
}

func (t *tx) DeleteTenant(_ context.Context, _ string) error {
	return errors.New("postgres: DeleteTenant not implemented")
}

// ---------------------------------------------------------------------------
// Memberships
// ---------------------------------------------------------------------------

func (t *tx) CreateMembership(_ context.Context, _ *store.Membership) (*store.Membership, error) {
	return nil, errors.New("postgres: CreateMembership not implemented")
}

func (t *tx) GetMembership(_ context.Context, _ string) (*store.Membership, error) {
	return nil, errors.New("postgres: GetMembership not implemented")
}

func (t *tx) GetMembershipByTenantUser(_ context.Context, _, _ string) (*store.Membership, error) {
	return nil, errors.New("postgres: GetMembershipByTenantUser not implemented")
}

func (t *tx) ListMembershipsByTenant(_ context.Context, _ string) ([]*store.Membership, error) {
	return nil, errors.New("postgres: ListMembershipsByTenant not implemented")
}

func (t *tx) ListMembershipsByUser(_ context.Context, _ string) ([]*store.Membership, error) {
	return nil, errors.New("postgres: ListMembershipsByUser not implemented")
}

func (t *tx) UpdateMembershipState(_ context.Context, _, _ string) (*store.Membership, error) {
	return nil, errors.New("postgres: UpdateMembershipState not implemented")
}

func (t *tx) DeleteMembership(_ context.Context, _ string) error {
	return errors.New("postgres: DeleteMembership not implemented")
}

// ---------------------------------------------------------------------------
// Membership Roles
// ---------------------------------------------------------------------------

func (t *tx) AssignMembershipRole(_ context.Context, _, _, _ string) error {
	return errors.New("postgres: AssignMembershipRole not implemented")
}

func (t *tx) RevokeMembershipRole(_ context.Context, _, _ string) error {
	return errors.New("postgres: RevokeMembershipRole not implemented")
}

func (t *tx) ListMembershipRoles(_ context.Context, _ string) ([]store.Role, error) {
	return nil, errors.New("postgres: ListMembershipRoles not implemented")
}

// ---------------------------------------------------------------------------
// Dashboards
// ---------------------------------------------------------------------------

func (t *tx) CreateDashboard(_ context.Context, _ *store.Dashboard) (*store.Dashboard, error) {
	return nil, errors.New("postgres: CreateDashboard not implemented")
}

func (t *tx) GetDashboard(_ context.Context, _, _ string) (*store.Dashboard, error) {
	return nil, errors.New("postgres: GetDashboard not implemented")
}

func (t *tx) ListDashboardsByTenant(_ context.Context, _ string) ([]*store.Dashboard, error) {
	return nil, errors.New("postgres: ListDashboardsByTenant not implemented")
}

func (t *tx) UpdateDashboard(_ context.Context, _, _ string, _ store.UpdateDashboardParams) (*store.Dashboard, error) {
	return nil, errors.New("postgres: UpdateDashboard not implemented")
}

func (t *tx) DeleteDashboard(_ context.Context, _, _ string) error {
	return errors.New("postgres: DeleteDashboard not implemented")
}

func (t *tx) SetDefaultDashboard(_ context.Context, _, _ string) (*store.Dashboard, error) {
	return nil, errors.New("postgres: SetDefaultDashboard not implemented")
}

func (t *tx) SetDashboardHomeForUser(_ context.Context, _, _, _ string) (*store.Dashboard, error) {
	return nil, errors.New("postgres: SetDashboardHomeForUser not implemented")
}

// ---------------------------------------------------------------------------
// Widgets
// ---------------------------------------------------------------------------

func (t *tx) CreateWidget(_ context.Context, _ *store.Widget) (*store.Widget, error) {
	return nil, errors.New("postgres: CreateWidget not implemented")
}

func (t *tx) GetWidget(_ context.Context, _ string) (*store.Widget, error) {
	return nil, errors.New("postgres: GetWidget not implemented")
}

func (t *tx) ListWidgetsByDashboard(_ context.Context, _ string) ([]*store.Widget, error) {
	return nil, errors.New("postgres: ListWidgetsByDashboard not implemented")
}

func (t *tx) UpdateWidget(_ context.Context, _ string, _ store.UpdateWidgetParams) (*store.Widget, error) {
	return nil, errors.New("postgres: UpdateWidget not implemented")
}

func (t *tx) DeleteWidget(_ context.Context, _, _ string) error {
	return errors.New("postgres: DeleteWidget not implemented")
}

func (t *tx) UpdateDashboardLayout(_ context.Context, _ string, _ map[string]string) error {
	return errors.New("postgres: UpdateDashboardLayout not implemented")
}

// ---------------------------------------------------------------------------
// Dashboard Versions
// ---------------------------------------------------------------------------

func (t *tx) CreateDashboardVersion(_ context.Context, _ *store.DashboardVersion) (*store.DashboardVersion, error) {
	return nil, errors.New("postgres: CreateDashboardVersion not implemented")
}

func (t *tx) GetDashboardVersion(_ context.Context, _ string) (*store.DashboardVersion, error) {
	return nil, errors.New("postgres: GetDashboardVersion not implemented")
}

func (t *tx) ListDashboardVersions(_ context.Context, _ string) ([]*store.DashboardVersion, error) {
	return nil, errors.New("postgres: ListDashboardVersions not implemented")
}

// ---------------------------------------------------------------------------
// Dashboard Shares
// ---------------------------------------------------------------------------

func (t *tx) CreateDashboardShare(_ context.Context, _ *store.DashboardShare) (*store.DashboardShare, error) {
	return nil, errors.New("postgres: CreateDashboardShare not implemented")
}

func (t *tx) ListDashboardShares(_ context.Context, _ string) ([]*store.DashboardShare, error) {
	return nil, errors.New("postgres: ListDashboardShares not implemented")
}

func (t *tx) DeleteDashboardShare(_ context.Context, _ string) error {
	return errors.New("postgres: DeleteDashboardShare not implemented")
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

func (t *tx) CreateWebhookEndpoint(_ context.Context, _ *store.WebhookEndpoint) (*store.WebhookEndpoint, error) {
	return nil, errors.New("postgres: CreateWebhookEndpoint not implemented")
}

func (t *tx) GetWebhookEndpoint(_ context.Context, _, _ string) (*store.WebhookEndpoint, error) {
	return nil, errors.New("postgres: GetWebhookEndpoint not implemented")
}

func (t *tx) ListWebhookEndpointsByTenant(_ context.Context, _ string) ([]*store.WebhookEndpoint, error) {
	return nil, errors.New("postgres: ListWebhookEndpointsByTenant not implemented")
}

func (t *tx) UpdateWebhookEndpoint(_ context.Context, _, _ string, _ store.UpdateWebhookEndpointParams) (*store.WebhookEndpoint, error) {
	return nil, errors.New("postgres: UpdateWebhookEndpoint not implemented")
}

func (t *tx) DeleteWebhookEndpoint(_ context.Context, _, _ string) error {
	return errors.New("postgres: DeleteWebhookEndpoint not implemented")
}

// ---------------------------------------------------------------------------
// Cluster Enrollment Tokens
// ---------------------------------------------------------------------------

func (t *tx) CreateEnrollmentToken(_ context.Context, _ *store.ClusterEnrollmentToken) (*store.ClusterEnrollmentToken, error) {
	return nil, errors.New("postgres: CreateEnrollmentToken not implemented")
}

func (t *tx) GetEnrollmentTokenByHash(_ context.Context, _ string) (*store.ClusterEnrollmentToken, error) {
	return nil, errors.New("postgres: GetEnrollmentTokenByHash not implemented")
}

func (t *tx) ListActiveEnrollmentTokens(_ context.Context) ([]*store.ClusterEnrollmentToken, error) {
	return nil, errors.New("postgres: ListActiveEnrollmentTokens not implemented")
}

func (t *tx) ConsumeEnrollmentToken(_ context.Context, _, _ string) (*store.ClusterEnrollmentToken, error) {
	return nil, errors.New("postgres: ConsumeEnrollmentToken not implemented")
}

func (t *tx) RevokeEnrollmentToken(_ context.Context, _ string) error {
	return errors.New("postgres: RevokeEnrollmentToken not implemented")
}

// ---------------------------------------------------------------------------
// Impersonation Sessions
// ---------------------------------------------------------------------------

func (t *tx) CreateImpersonationSession(_ context.Context, _ *store.ImpersonationSession) (*store.ImpersonationSession, error) {
	return nil, errors.New("postgres: CreateImpersonationSession not implemented")
}

func (t *tx) GetImpersonationSession(_ context.Context, _ string) (*store.ImpersonationSession, error) {
	return nil, errors.New("postgres: GetImpersonationSession not implemented")
}

func (t *tx) ListActiveImpersonationSessions(_ context.Context) ([]*store.ImpersonationSession, error) {
	return nil, errors.New("postgres: ListActiveImpersonationSessions not implemented")
}

func (t *tx) EndImpersonationSession(_ context.Context, _, _ string) (*store.ImpersonationSession, error) {
	return nil, errors.New("postgres: EndImpersonationSession not implemented")
}

func (t *tx) TouchImpersonationSession(_ context.Context, _ string) error {
	return errors.New("postgres: TouchImpersonationSession not implemented")
}

// ---------------------------------------------------------------------------
// Settings configs (singleton per tenant)
// ---------------------------------------------------------------------------

func (t *tx) GetNetworkConfig(_ context.Context, _ string) (*store.NetworkConfig, error) {
	return nil, errors.New("postgres: GetNetworkConfig not implemented")
}

func (t *tx) UpsertNetworkConfig(_ context.Context, _ *store.NetworkConfig) (*store.NetworkConfig, error) {
	return nil, errors.New("postgres: UpsertNetworkConfig not implemented")
}

func (t *tx) GetTenantAuthPolicy(_ context.Context, _ string) (*store.TenantAuthPolicy, error) {
	return nil, errors.New("postgres: GetTenantAuthPolicy not implemented")
}

func (t *tx) UpsertTenantAuthPolicy(_ context.Context, _ *store.TenantAuthPolicy) (*store.TenantAuthPolicy, error) {
	return nil, errors.New("postgres: UpsertTenantAuthPolicy not implemented")
}

func (t *tx) GetObservabilityConfig(_ context.Context, _ string) (*store.ObservabilityConfig, error) {
	return nil, errors.New("postgres: GetObservabilityConfig not implemented")
}

func (t *tx) UpsertObservabilityConfig(_ context.Context, _ *store.ObservabilityConfig) (*store.ObservabilityConfig, error) {
	return nil, errors.New("postgres: UpsertObservabilityConfig not implemented")
}

func (t *tx) GetAuditRetentionConfig(_ context.Context, _ string) (*store.AuditRetentionConfig, error) {
	return nil, errors.New("postgres: GetAuditRetentionConfig not implemented")
}

func (t *tx) UpsertAuditRetentionConfig(_ context.Context, _ *store.AuditRetentionConfig) (*store.AuditRetentionConfig, error) {
	return nil, errors.New("postgres: UpsertAuditRetentionConfig not implemented")
}

// ---------------------------------------------------------------------------
// PKI / TLS
// ---------------------------------------------------------------------------

func (t *tx) CreateCertAuthority(_ context.Context, _ *store.CertAuthority) (*store.CertAuthority, error) {
	return nil, errors.New("postgres: CreateCertAuthority not implemented")
}

func (t *tx) GetCertAuthority(_ context.Context, _, _ string) (*store.CertAuthority, error) {
	return nil, errors.New("postgres: GetCertAuthority not implemented")
}

func (t *tx) ListCertAuthoritiesByTenant(_ context.Context, _ string) ([]*store.CertAuthority, error) {
	return nil, errors.New("postgres: ListCertAuthoritiesByTenant not implemented")
}

func (t *tx) UpdateCertAuthority(_ context.Context, _, _ string, _ store.UpdateCertAuthorityParams) (*store.CertAuthority, error) {
	return nil, errors.New("postgres: UpdateCertAuthority not implemented")
}

func (t *tx) DeleteCertAuthority(_ context.Context, _, _ string) error {
	return errors.New("postgres: DeleteCertAuthority not implemented")
}

func (t *tx) CreateCertEnrollment(_ context.Context, _ *store.CertEnrollment) (*store.CertEnrollment, error) {
	return nil, errors.New("postgres: CreateCertEnrollment not implemented")
}

func (t *tx) GetCertEnrollment(_ context.Context, _, _ string) (*store.CertEnrollment, error) {
	return nil, errors.New("postgres: GetCertEnrollment not implemented")
}

func (t *tx) ListCertEnrollmentsByTenant(_ context.Context, _ string) ([]*store.CertEnrollment, error) {
	return nil, errors.New("postgres: ListCertEnrollmentsByTenant not implemented")
}

func (t *tx) UpdateCertEnrollment(_ context.Context, _, _ string, _ store.UpdateCertEnrollmentParams) (*store.CertEnrollment, error) {
	return nil, errors.New("postgres: UpdateCertEnrollment not implemented")
}

func (t *tx) RevokeCertEnrollmentRow(_ context.Context, _, _, _ string) (*store.CertEnrollment, error) {
	return nil, errors.New("postgres: RevokeCertEnrollmentRow not implemented")
}

func (t *tx) CreateTLSCertificate(_ context.Context, _ *store.TLSCertificate) (*store.TLSCertificate, error) {
	return nil, errors.New("postgres: CreateTLSCertificate not implemented")
}

func (t *tx) GetTLSCertificate(_ context.Context, _, _ string) (*store.TLSCertificate, error) {
	return nil, errors.New("postgres: GetTLSCertificate not implemented")
}

func (t *tx) ListTLSCertificatesByTenant(_ context.Context, _ string) ([]*store.TLSCertificate, error) {
	return nil, errors.New("postgres: ListTLSCertificatesByTenant not implemented")
}

func (t *tx) UpdateTLSCertificate(_ context.Context, _, _ string, _ store.UpdateTLSCertificateParams) (*store.TLSCertificate, error) {
	return nil, errors.New("postgres: UpdateTLSCertificate not implemented")
}

func (t *tx) DeleteTLSCertificate(_ context.Context, _, _ string) error {
	return errors.New("postgres: DeleteTLSCertificate not implemented")
}

func (t *tx) GetTLSConfig(_ context.Context, _ string) (*store.TLSConfig, error) {
	return nil, errors.New("postgres: GetTLSConfig not implemented")
}

func (t *tx) UpsertTLSConfig(_ context.Context, _ *store.TLSConfig) (*store.TLSConfig, error) {
	return nil, errors.New("postgres: UpsertTLSConfig not implemented")
}

// ---------------------------------------------------------------------------
// Plugins
// ---------------------------------------------------------------------------

func (t *tx) CreatePlugin(_ context.Context, _ *store.Plugin) (*store.Plugin, error) {
	return nil, errors.New("postgres: CreatePlugin not implemented")
}

func (t *tx) GetPlugin(_ context.Context, _, _ string) (*store.Plugin, error) {
	return nil, errors.New("postgres: GetPlugin not implemented")
}

func (t *tx) ListPluginsByScope(_ context.Context, _ string) ([]*store.Plugin, error) {
	return nil, errors.New("postgres: ListPluginsByScope not implemented")
}

func (t *tx) UpdatePlugin(_ context.Context, _, _ string, _ store.UpdatePluginParams) (*store.Plugin, error) {
	return nil, errors.New("postgres: UpdatePlugin not implemented")
}

func (t *tx) DeletePlugin(_ context.Context, _, _ string) error {
	return errors.New("postgres: DeletePlugin not implemented")
}

func (t *tx) CreatePluginSigner(_ context.Context, _ *store.PluginSigner) (*store.PluginSigner, error) {
	return nil, errors.New("postgres: CreatePluginSigner not implemented")
}

func (t *tx) GetPluginSigner(_ context.Context, _, _ string) (*store.PluginSigner, error) {
	return nil, errors.New("postgres: GetPluginSigner not implemented")
}

func (t *tx) ListPluginSignersByScope(_ context.Context, _ string) ([]*store.PluginSigner, error) {
	return nil, errors.New("postgres: ListPluginSignersByScope not implemented")
}

func (t *tx) UpdatePluginSigner(_ context.Context, _, _ string, _ store.UpdatePluginSignerParams) (*store.PluginSigner, error) {
	return nil, errors.New("postgres: UpdatePluginSigner not implemented")
}

func (t *tx) DeletePluginSigner(_ context.Context, _, _ string) error {
	return errors.New("postgres: DeletePluginSigner not implemented")
}

func (t *tx) ListPluginsBySigner(_ context.Context, _ string) ([]*store.Plugin, error) {
	return nil, errors.New("postgres: ListPluginsBySigner not implemented")
}

// ---------------------------------------------------------------------------
// Notifications — Items
// ---------------------------------------------------------------------------

func (t *tx) AppendNotificationItem(_ context.Context, _ *store.NotificationItem) (*store.NotificationItem, error) {
	return nil, errors.New("postgres: AppendNotificationItem not implemented")
}

func (t *tx) GetNotificationItem(_ context.Context, _ string) (*store.NotificationItem, error) {
	return nil, errors.New("postgres: GetNotificationItem not implemented")
}

func (t *tx) ListNotificationItemsByUser(_ context.Context, _, _ string, _ store.NotificationItemQuery) ([]*store.NotificationItem, error) {
	return nil, errors.New("postgres: ListNotificationItemsByUser not implemented")
}

func (t *tx) CountUnreadNotifications(_ context.Context, _, _ string) (int, error) {
	return 0, errors.New("postgres: CountUnreadNotifications not implemented")
}

func (t *tx) MarkNotificationRead(_ context.Context, _ string) error {
	return errors.New("postgres: MarkNotificationRead not implemented")
}

func (t *tx) MarkAllNotificationsRead(_ context.Context, _, _ string) error {
	return errors.New("postgres: MarkAllNotificationsRead not implemented")
}

func (t *tx) ArchiveNotification(_ context.Context, _ string, _ bool) error {
	return errors.New("postgres: ArchiveNotification not implemented")
}

// ---------------------------------------------------------------------------
// Notifications — Channels
// ---------------------------------------------------------------------------

func (t *tx) CreateNotificationChannel(_ context.Context, _ *store.NotificationChannel) (*store.NotificationChannel, error) {
	return nil, errors.New("postgres: CreateNotificationChannel not implemented")
}

func (t *tx) GetNotificationChannel(_ context.Context, _, _ string) (*store.NotificationChannel, error) {
	return nil, errors.New("postgres: GetNotificationChannel not implemented")
}

func (t *tx) ListNotificationChannelsByTenant(_ context.Context, _ string) ([]*store.NotificationChannel, error) {
	return nil, errors.New("postgres: ListNotificationChannelsByTenant not implemented")
}

func (t *tx) UpdateNotificationChannel(_ context.Context, _, _ string, _ store.UpdateNotificationChannelParams) (*store.NotificationChannel, error) {
	return nil, errors.New("postgres: UpdateNotificationChannel not implemented")
}

func (t *tx) DeleteNotificationChannel(_ context.Context, _, _ string) error {
	return errors.New("postgres: DeleteNotificationChannel not implemented")
}

// ---------------------------------------------------------------------------
// Notifications — Routing Rules
// ---------------------------------------------------------------------------

func (t *tx) CreateRoutingRule(_ context.Context, _ *store.NotificationRoutingRule) (*store.NotificationRoutingRule, error) {
	return nil, errors.New("postgres: CreateRoutingRule not implemented")
}

func (t *tx) GetRoutingRule(_ context.Context, _, _ string) (*store.NotificationRoutingRule, error) {
	return nil, errors.New("postgres: GetRoutingRule not implemented")
}

func (t *tx) ListRoutingRulesByTenant(_ context.Context, _ string) ([]*store.NotificationRoutingRule, error) {
	return nil, errors.New("postgres: ListRoutingRulesByTenant not implemented")
}

func (t *tx) UpdateRoutingRule(_ context.Context, _, _ string, _ store.UpdateRoutingRuleParams) (*store.NotificationRoutingRule, error) {
	return nil, errors.New("postgres: UpdateRoutingRule not implemented")
}

func (t *tx) DeleteRoutingRule(_ context.Context, _, _ string) error {
	return errors.New("postgres: DeleteRoutingRule not implemented")
}

func (t *tx) ReorderRoutingRules(_ context.Context, _ string, _ []string) error {
	return errors.New("postgres: ReorderRoutingRules not implemented")
}

// ---------------------------------------------------------------------------
// Notifications — Delivery Log
// ---------------------------------------------------------------------------

func (t *tx) AppendDeliveryLogEntry(_ context.Context, _ *store.NotificationDeliveryLogEntry) (*store.NotificationDeliveryLogEntry, error) {
	return nil, errors.New("postgres: AppendDeliveryLogEntry not implemented")
}

func (t *tx) GetDeliveryLogEntry(_ context.Context, _, _ string) (*store.NotificationDeliveryLogEntry, error) {
	return nil, errors.New("postgres: GetDeliveryLogEntry not implemented")
}

func (t *tx) ListDeliveryLogByTenant(_ context.Context, _ string, _ store.DeliveryLogQuery) ([]*store.NotificationDeliveryLogEntry, error) {
	return nil, errors.New("postgres: ListDeliveryLogByTenant not implemented")
}

// ---------------------------------------------------------------------------
// Notifications — Tenant Config
// ---------------------------------------------------------------------------

func (t *tx) GetTenantNotificationConfig(_ context.Context, _ string) (*store.TenantNotificationConfig, error) {
	return nil, errors.New("postgres: GetTenantNotificationConfig not implemented")
}

func (t *tx) UpsertTenantNotificationConfig(_ context.Context, _ *store.TenantNotificationConfig) (*store.TenantNotificationConfig, error) {
	return nil, errors.New("postgres: UpsertTenantNotificationConfig not implemented")
}

// ---------------------------------------------------------------------------
// AI — Providers
// ---------------------------------------------------------------------------

func (t *tx) CreateAIProvider(_ context.Context, _ *store.AIProvider) (*store.AIProvider, error) {
	return nil, errors.New("postgres: CreateAIProvider not implemented")
}

func (t *tx) GetAIProvider(_ context.Context, _, _ string) (*store.AIProvider, error) {
	return nil, errors.New("postgres: GetAIProvider not implemented")
}

func (t *tx) ListAIProvidersByTenant(_ context.Context, _ string) ([]*store.AIProvider, error) {
	return nil, errors.New("postgres: ListAIProvidersByTenant not implemented")
}

func (t *tx) UpdateAIProvider(_ context.Context, _, _ string, _ store.UpdateAIProviderParams) (*store.AIProvider, error) {
	return nil, errors.New("postgres: UpdateAIProvider not implemented")
}

func (t *tx) DeleteAIProvider(_ context.Context, _, _ string) error {
	return errors.New("postgres: DeleteAIProvider not implemented")
}

// ---------------------------------------------------------------------------
// AI — Provider Models
// ---------------------------------------------------------------------------

func (t *tx) AddProviderModel(_ context.Context, _ *store.AIProviderModel) (*store.AIProviderModel, error) {
	return nil, errors.New("postgres: AddProviderModel not implemented")
}

func (t *tx) UpdateProviderModel(_ context.Context, _, _ string, _ store.UpdateAIProviderModelParams) (*store.AIProviderModel, error) {
	return nil, errors.New("postgres: UpdateProviderModel not implemented")
}

func (t *tx) RemoveProviderModel(_ context.Context, _, _ string) error {
	return errors.New("postgres: RemoveProviderModel not implemented")
}

func (t *tx) ListProviderModels(_ context.Context, _ string) ([]*store.AIProviderModel, error) {
	return nil, errors.New("postgres: ListProviderModels not implemented")
}

// ---------------------------------------------------------------------------
// AI — MCP Servers
// ---------------------------------------------------------------------------

func (t *tx) CreateMCPServer(_ context.Context, _ *store.AIMCPServer) (*store.AIMCPServer, error) {
	return nil, errors.New("postgres: CreateMCPServer not implemented")
}

func (t *tx) GetMCPServer(_ context.Context, _, _ string) (*store.AIMCPServer, error) {
	return nil, errors.New("postgres: GetMCPServer not implemented")
}

func (t *tx) ListMCPServersByTenant(_ context.Context, _ string) ([]*store.AIMCPServer, error) {
	return nil, errors.New("postgres: ListMCPServersByTenant not implemented")
}

func (t *tx) UpdateMCPServer(_ context.Context, _, _ string, _ store.UpdateAIMCPServerParams) (*store.AIMCPServer, error) {
	return nil, errors.New("postgres: UpdateMCPServer not implemented")
}

func (t *tx) DeleteMCPServer(_ context.Context, _, _ string) error {
	return errors.New("postgres: DeleteMCPServer not implemented")
}

// ---------------------------------------------------------------------------
// AI — Tools
// ---------------------------------------------------------------------------

func (t *tx) CreateAITool(_ context.Context, _ *store.AITool) (*store.AITool, error) {
	return nil, errors.New("postgres: CreateAITool not implemented")
}

func (t *tx) GetAITool(_ context.Context, _, _ string) (*store.AITool, error) {
	return nil, errors.New("postgres: GetAITool not implemented")
}

func (t *tx) ListAIToolsByTenant(_ context.Context, _ string) ([]*store.AITool, error) {
	return nil, errors.New("postgres: ListAIToolsByTenant not implemented")
}

func (t *tx) UpdateAITool(_ context.Context, _, _ string, _ store.UpdateAIToolParams) (*store.AITool, error) {
	return nil, errors.New("postgres: UpdateAITool not implemented")
}

func (t *tx) DeleteAITool(_ context.Context, _, _ string) error {
	return errors.New("postgres: DeleteAITool not implemented")
}

// ---------------------------------------------------------------------------
// AI — Agents
// ---------------------------------------------------------------------------

func (t *tx) CreateAIAgent(_ context.Context, _ *store.AIAgent) (*store.AIAgent, error) {
	return nil, errors.New("postgres: CreateAIAgent not implemented")
}

func (t *tx) GetAIAgent(_ context.Context, _, _ string) (*store.AIAgent, error) {
	return nil, errors.New("postgres: GetAIAgent not implemented")
}

func (t *tx) ListAIAgentsByTenant(_ context.Context, _ string) ([]*store.AIAgent, error) {
	return nil, errors.New("postgres: ListAIAgentsByTenant not implemented")
}

func (t *tx) UpdateAIAgent(_ context.Context, _, _ string, _ store.UpdateAIAgentParams) (*store.AIAgent, error) {
	return nil, errors.New("postgres: UpdateAIAgent not implemented")
}

func (t *tx) DeleteAIAgent(_ context.Context, _, _ string) error {
	return errors.New("postgres: DeleteAIAgent not implemented")
}

// ---------------------------------------------------------------------------
// AI — Tool Bindings
// ---------------------------------------------------------------------------

func (t *tx) CreateAIToolBinding(_ context.Context, _ *store.AIToolBinding) (*store.AIToolBinding, error) {
	return nil, errors.New("postgres: CreateAIToolBinding not implemented")
}

func (t *tx) GetAIToolBinding(_ context.Context, _, _ string) (*store.AIToolBinding, error) {
	return nil, errors.New("postgres: GetAIToolBinding not implemented")
}

func (t *tx) ListAIToolBindingsByTenant(_ context.Context, _ string) ([]*store.AIToolBinding, error) {
	return nil, errors.New("postgres: ListAIToolBindingsByTenant not implemented")
}

func (t *tx) ListAIToolBindingsByAgent(_ context.Context, _ string) ([]*store.AIToolBinding, error) {
	return nil, errors.New("postgres: ListAIToolBindingsByAgent not implemented")
}

func (t *tx) UpdateAIToolBinding(_ context.Context, _, _ string, _ store.UpdateAIToolBindingParams) (*store.AIToolBinding, error) {
	return nil, errors.New("postgres: UpdateAIToolBinding not implemented")
}

func (t *tx) DeleteAIToolBinding(_ context.Context, _, _ string) error {
	return errors.New("postgres: DeleteAIToolBinding not implemented")
}

// ---------------------------------------------------------------------------
// AI — Semantic Rate Limits
// ---------------------------------------------------------------------------

func (t *tx) CreateAIRateLimit(_ context.Context, _ *store.AISemanticRateLimit) (*store.AISemanticRateLimit, error) {
	return nil, errors.New("postgres: CreateAIRateLimit not implemented")
}

func (t *tx) GetAIRateLimit(_ context.Context, _, _ string) (*store.AISemanticRateLimit, error) {
	return nil, errors.New("postgres: GetAIRateLimit not implemented")
}

func (t *tx) ListAIRateLimitsByTenant(_ context.Context, _ string) ([]*store.AISemanticRateLimit, error) {
	return nil, errors.New("postgres: ListAIRateLimitsByTenant not implemented")
}

func (t *tx) UpdateAIRateLimit(_ context.Context, _, _ string, _ store.UpdateAIRateLimitParams) (*store.AISemanticRateLimit, error) {
	return nil, errors.New("postgres: UpdateAIRateLimit not implemented")
}

func (t *tx) DeleteAIRateLimit(_ context.Context, _, _ string) error {
	return errors.New("postgres: DeleteAIRateLimit not implemented")
}

// ---------------------------------------------------------------------------
// AI — Traces
// ---------------------------------------------------------------------------

func (t *tx) AppendAITrace(_ context.Context, _ *store.AITrace) (*store.AITrace, error) {
	return nil, errors.New("postgres: AppendAITrace not implemented")
}

func (t *tx) GetAITrace(_ context.Context, _, _ string) (*store.AITrace, error) {
	return nil, errors.New("postgres: GetAITrace not implemented")
}

func (t *tx) ListAITracesByTenant(_ context.Context, _ string, _ store.AITraceQuery) ([]*store.AITrace, error) {
	return nil, errors.New("postgres: ListAITracesByTenant not implemented")
}

func (t *tx) ListAITracesByAgent(_ context.Context, _ string, _ store.AITraceQuery) ([]*store.AITrace, error) {
	return nil, errors.New("postgres: ListAITracesByAgent not implemented")
}

// ---------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------

func (t *tx) CreateSite(_ context.Context, _ *store.Site) (*store.Site, error) {
	return nil, errors.New("postgres: CreateSite not implemented")
}

func (t *tx) GetSite(_ context.Context, _, _ string) (*store.Site, error) {
	return nil, errors.New("postgres: GetSite not implemented")
}

func (t *tx) ListSitesByTenant(_ context.Context, _ string) ([]*store.Site, error) {
	return nil, errors.New("postgres: ListSitesByTenant not implemented")
}

func (t *tx) UpdateSite(_ context.Context, _, _ string, _ store.UpdateSiteParams) (*store.Site, error) {
	return nil, errors.New("postgres: UpdateSite not implemented")
}

func (t *tx) ToggleSite(_ context.Context, _, _ string, _ bool) (*store.Site, error) {
	return nil, errors.New("postgres: ToggleSite not implemented")
}

func (t *tx) DeleteSite(_ context.Context, _, _ string) error {
	return errors.New("postgres: DeleteSite not implemented")
}

// ---------------------------------------------------------------------------
// Middlewares
// ---------------------------------------------------------------------------

func (t *tx) CreateMiddleware(_ context.Context, _ *store.Middleware) (*store.Middleware, error) {
	return nil, errors.New("postgres: CreateMiddleware not implemented")
}

func (t *tx) GetMiddleware(_ context.Context, _, _ string) (*store.Middleware, error) {
	return nil, errors.New("postgres: GetMiddleware not implemented")
}

func (t *tx) ListMiddlewaresByTenant(_ context.Context, _ string) ([]*store.Middleware, error) {
	return nil, errors.New("postgres: ListMiddlewaresByTenant not implemented")
}

func (t *tx) UpdateMiddleware(_ context.Context, _, _ string, _ store.UpdateMiddlewareParams) (*store.Middleware, error) {
	return nil, errors.New("postgres: UpdateMiddleware not implemented")
}

func (t *tx) DeleteMiddleware(_ context.Context, _, _ string) error {
	return errors.New("postgres: DeleteMiddleware not implemented")
}

// ---------------------------------------------------------------------------
// RBAC Policies
// ---------------------------------------------------------------------------

func (t *tx) CreateRbacPolicy(_ context.Context, _ *store.RbacPolicy) (*store.RbacPolicy, error) {
	return nil, errors.New("postgres: CreateRbacPolicy not implemented")
}

func (t *tx) GetRbacPolicy(_ context.Context, _ string) (*store.RbacPolicy, error) {
	return nil, errors.New("postgres: GetRbacPolicy not implemented")
}

func (t *tx) ListRbacPolicies(_ context.Context) ([]*store.RbacPolicy, error) {
	return nil, errors.New("postgres: ListRbacPolicies not implemented")
}

func (t *tx) UpdateRbacPolicy(_ context.Context, _ string, _ store.UpdateRbacPolicyParams) (*store.RbacPolicy, error) {
	return nil, errors.New("postgres: UpdateRbacPolicy not implemented")
}

func (t *tx) DeleteRbacPolicy(_ context.Context, _ string) error {
	return errors.New("postgres: DeleteRbacPolicy not implemented")
}

// ---------------------------------------------------------------------------
// Access Policies
// ---------------------------------------------------------------------------

func (t *tx) CreateAccessPolicy(_ context.Context, _ *store.AccessPolicy) (*store.AccessPolicy, error) {
	return nil, errors.New("postgres: CreateAccessPolicy not implemented")
}

func (t *tx) GetAccessPolicy(_ context.Context, _ string) (*store.AccessPolicy, error) {
	return nil, errors.New("postgres: GetAccessPolicy not implemented")
}

func (t *tx) ListAccessPolicies(_ context.Context) ([]*store.AccessPolicy, error) {
	return nil, errors.New("postgres: ListAccessPolicies not implemented")
}

func (t *tx) UpdateAccessPolicy(_ context.Context, _ string, _ store.UpdateAccessPolicyParams) (*store.AccessPolicy, error) {
	return nil, errors.New("postgres: UpdateAccessPolicy not implemented")
}

func (t *tx) DeleteAccessPolicy(_ context.Context, _ string) error {
	return errors.New("postgres: DeleteAccessPolicy not implemented")
}
