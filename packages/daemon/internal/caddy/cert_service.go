// Package caddy — certificate management abstraction (#84).
//
// Caddy automates TLS certificate provisioning + renewal but exposes a
// patchy admin API: `/load` accepts a full config push, but there is no
// well-defined `/certs` listing endpoint and no programmatic
// renew/revoke. The clean integration story lands alongside #77 (Caddy
// cert lifecycle audit) — until then, this package defines the gateway
// contract so the admin panel + REST surface can be built without
// blocking on the Caddy work.
//
// Implementations:
//
//   - StubCertService: returns an empty list and a structured "not
//     implemented in stage-1" message for renew/revoke. Ships today so
//     the /api/v1/certificates endpoints exist and return well-shaped
//     bodies.
//   - (future) CaddyCertService: scans the `${data_dir}/caddy/
//     certificates/` filesystem, parses PEM metadata, and proxies
//     renew/revoke through Caddy's admin API + PKI app.
package caddy

import (
	"context"
	"errors"
	"time"
)

// CertStatus is the high-level lifecycle bucket the admin renders.
type CertStatus string

const (
	CertStatusActive   CertStatus = "active"
	CertStatusExpiring CertStatus = "expiring"
	CertStatusExpired  CertStatus = "expired"
	CertStatusRevoked  CertStatus = "revoked"
	CertStatusPending  CertStatus = "pending"
	CertStatusError    CertStatus = "error"
)

// Certificate is the rolled-up per-cert payload returned to the admin.
type Certificate struct {
	// ID is a stable identifier — typically the SHA-256 fingerprint hex.
	ID             string     `json:"id"`
	Domain         string     `json:"domain"`
	SANs           []string   `json:"sans"`
	Issuer         string     `json:"issuer"`
	Serial         string     `json:"serial"`
	FingerprintSHA string     `json:"fingerprintSha256"`
	NotBefore      time.Time  `json:"notBefore"`
	NotAfter       time.Time  `json:"notAfter"`
	Status         CertStatus `json:"status"`
	AutoRenew      bool       `json:"autoRenew"`
	ManagedByCaddy bool       `json:"managedByCaddy"`
	ACMEDirectory  string     `json:"acmeDirectory,omitempty"`
	StoragePath    string     `json:"storagePath,omitempty"`
	LastRenewedAt  *time.Time `json:"lastRenewedAt,omitempty"`
}

// CertActionResult is returned from Renew / Revoke.
type CertActionResult struct {
	StartedAt time.Time     `json:"startedAt"`
	Duration  time.Duration `json:"duration"`
	Note      string        `json:"note,omitempty"`
	// Certificate is the post-action snapshot (if available). nil when
	// the action queues an async refresh.
	Certificate *Certificate `json:"certificate,omitempty"`
}

// ErrCertNotFound is returned when an id doesn't match a known cert.
var ErrCertNotFound = errors.New("caddy: certificate not found")

// CertService is the gateway-facing API for certificate management.
type CertService interface {
	// ListCertificates returns every certificate Caddy is managing.
	// Empty slice (never nil) when no certs are known.
	ListCertificates(ctx context.Context) ([]Certificate, error)
	// RenewCertificate forces an out-of-band renewal of the named cert.
	// Returns ErrCertNotFound for unknown ids.
	RenewCertificate(ctx context.Context, id string) (CertActionResult, error)
	// RevokeCertificate revokes a cert via the issuing CA's OCSP/CRL
	// machinery. Returns ErrCertNotFound for unknown ids.
	RevokeCertificate(ctx context.Context, id string) (CertActionResult, error)
}

// ─── StubCertService ────────────────────────────────────────────────────────

// StubCertService is the default CertService for stage-1 deployments
// where the Caddy filesystem scan + admin-API integration aren't wired
// yet. It returns an empty list and a structured "not implemented"
// response for actions so the admin panel can render without 404s and
// operators see exactly what's missing.
type StubCertService struct{}

// NewStubCertService returns the stage-1 stub implementation.
func NewStubCertService() *StubCertService { return &StubCertService{} }

// ListCertificates returns an empty list — Caddy filesystem scanning is
// not yet implemented.
func (s *StubCertService) ListCertificates(_ context.Context) ([]Certificate, error) {
	return []Certificate{}, nil
}

// RenewCertificate is a no-op that surfaces the stage-2 plan.
func (s *StubCertService) RenewCertificate(_ context.Context, _ string) (CertActionResult, error) {
	return CertActionResult{
		StartedAt: time.Now().UTC(),
		Note:      "Force-renewal is not implemented in stage-1. Caddy auto-renews managed certs ~30 days before expiry; manual triggering will land in stage-2 alongside the Caddy cert lifecycle integration (#77).",
	}, nil
}

// RevokeCertificate is a no-op that surfaces the stage-2 plan.
func (s *StubCertService) RevokeCertificate(_ context.Context, _ string) (CertActionResult, error) {
	return CertActionResult{
		StartedAt: time.Now().UTC(),
		Note:      "Revocation is not implemented in stage-1. For internal-CA-issued certs this needs CRL/OCSP machinery; for external (Let's Encrypt) certs, revocation is a separate ACME flow. Both land in stage-2 alongside the Caddy cert lifecycle integration (#77).",
	}, nil
}
