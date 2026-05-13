// Package gateway: PKI + TLS REST endpoints.
//
// Routes (per the admin panel spec):
//
//	/api/v1/t/{tenant}/settings/pki/cas              CertAuthorities (CRUD)
//	/api/v1/t/{tenant}/settings/pki/enrollments      CertEnrollments (CR + revoke)
//	/api/v1/t/{tenant}/settings/tls/certificates     TLSCertificates (CRUD + toggle auto-renew)
//	/api/v1/t/{tenant}/settings/tls/config           TLSConfig (singleton get + acme/cipher PUTs)
package gateway

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/riokulabs/rioku/internal/rerr"
	"github.com/riokulabs/rioku/internal/store"
)

func RegisterPKIRoutes(mux *http.ServeMux, st store.Driver) {
	// Cert Authorities
	mux.Handle("GET /api/v1/t/{tenant}/settings/pki/cas",
		RequirePermission("pki:read")(rerr.H(handleListCAs(st))))
	mux.Handle("POST /api/v1/t/{tenant}/settings/pki/cas",
		RequirePermission("pki:write")(rerr.H(handleCreateCA(st))))
	mux.Handle("GET /api/v1/t/{tenant}/settings/pki/cas/{id}",
		RequirePermission("pki:read")(rerr.H(handleGetCA(st))))
	mux.Handle("PUT /api/v1/t/{tenant}/settings/pki/cas/{id}",
		RequirePermission("pki:write")(rerr.H(handleUpdateCA(st))))
	mux.Handle("DELETE /api/v1/t/{tenant}/settings/pki/cas/{id}",
		RequirePermission("pki:write")(rerr.H(handleDeleteCA(st))))

	// Cert Enrollments
	mux.Handle("GET /api/v1/t/{tenant}/settings/pki/enrollments",
		RequirePermission("pki:read")(rerr.H(handleListEnrollments(st))))
	mux.Handle("POST /api/v1/t/{tenant}/settings/pki/enrollments",
		RequirePermission("pki:write")(rerr.H(handleCreateEnrollment(st))))
	mux.Handle("GET /api/v1/t/{tenant}/settings/pki/enrollments/{id}",
		RequirePermission("pki:read")(rerr.H(handleGetEnrollment(st))))
	mux.Handle("POST /api/v1/t/{tenant}/settings/pki/enrollments/{id}/revoke",
		RequirePermission("pki:write")(rerr.H(handleRevokeEnrollment(st))))

	// TLS Certificates
	mux.Handle("GET /api/v1/t/{tenant}/settings/tls/certificates",
		RequirePermission("tls:read")(rerr.H(handleListTLSCerts(st))))
	mux.Handle("POST /api/v1/t/{tenant}/settings/tls/certificates",
		RequirePermission("tls:write")(rerr.H(handleCreateTLSCert(st))))
	mux.Handle("GET /api/v1/t/{tenant}/settings/tls/certificates/{id}",
		RequirePermission("tls:read")(rerr.H(handleGetTLSCert(st))))
	mux.Handle("PATCH /api/v1/t/{tenant}/settings/tls/certificates/{id}/auto-renew",
		RequirePermission("tls:write")(rerr.H(handleToggleAutoRenew(st))))
	mux.Handle("DELETE /api/v1/t/{tenant}/settings/tls/certificates/{id}",
		RequirePermission("tls:write")(rerr.H(handleDeleteTLSCert(st))))

	// TLS Config (singleton)
	mux.Handle("GET /api/v1/t/{tenant}/settings/tls/config",
		RequirePermission("tls:read")(rerr.H(handleGetTLSConfig(st))))
	mux.Handle("PUT /api/v1/t/{tenant}/settings/tls/config/acme",
		RequirePermission("tls:write")(rerr.H(handleUpdateTLSACME(st))))
	mux.Handle("PUT /api/v1/t/{tenant}/settings/tls/config/ciphers",
		RequirePermission("tls:write")(rerr.H(handleUpdateTLSCiphers(st))))
}

// ─── DTOs ───────────────────────────────────────────────────────────────────

type caResponse struct {
	ID                string  `json:"id"`
	TenantID          string  `json:"tenantId"`
	Name              string  `json:"name"`
	Kind              string  `json:"kind"`
	Subject           string  `json:"subject"`
	NotBefore         *string `json:"notBefore,omitempty"`
	NotAfter          *string `json:"notAfter,omitempty"`
	FingerprintSHA256 *string `json:"fingerprintSha256,omitempty"`
	CreatedAt         string  `json:"createdAt"`
	UpdatedAt         string  `json:"updatedAt"`
	// CertificatePEM and PrivateKeyRef intentionally omitted from list/detail.
}

func caToResponse(c *store.CertAuthority) caResponse {
	out := caResponse{
		ID: c.ID, TenantID: c.TenantID, Name: c.Name, Kind: c.Kind, Subject: c.Subject,
		FingerprintSHA256: c.FingerprintSHA256,
		CreatedAt:         c.CreatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
		UpdatedAt:         c.UpdatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
	}
	if c.NotBefore != nil {
		s := c.NotBefore.UTC().Format("2006-01-02T15:04:05.000Z")
		out.NotBefore = &s
	}
	if c.NotAfter != nil {
		s := c.NotAfter.UTC().Format("2006-01-02T15:04:05.000Z")
		out.NotAfter = &s
	}
	return out
}

type enrollmentResponse struct {
	ID                string          `json:"id"`
	TenantID          string          `json:"tenantId"`
	CAID              *string         `json:"caId,omitempty"`
	Subject           string          `json:"subject"`
	DNSSANs           json.RawMessage `json:"dnsSans"`
	State             string          `json:"state"`
	RequestedAt       string          `json:"requestedAt"`
	IssuedAt          *string         `json:"issuedAt,omitempty"`
	RevokedAt         *string         `json:"revokedAt,omitempty"`
	RevocationReason  *string         `json:"revocationReason,omitempty"`
	FingerprintSHA256 *string         `json:"fingerprintSha256,omitempty"`
}

func enrollmentToResponse(e *store.CertEnrollment) enrollmentResponse {
	out := enrollmentResponse{
		ID: e.ID, TenantID: e.TenantID, CAID: e.CAID, Subject: e.Subject,
		DNSSANs: rawOrEmpty(e.DNSSANs, "[]"), State: e.State,
		RequestedAt:      e.RequestedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
		RevocationReason: e.RevocationReason, FingerprintSHA256: e.FingerprintSHA256,
	}
	if e.IssuedAt != nil {
		s := e.IssuedAt.UTC().Format("2006-01-02T15:04:05.000Z")
		out.IssuedAt = &s
	}
	if e.RevokedAt != nil {
		s := e.RevokedAt.UTC().Format("2006-01-02T15:04:05.000Z")
		out.RevokedAt = &s
	}
	return out
}

type tlsCertResponse struct {
	ID                string  `json:"id"`
	TenantID          string  `json:"tenantId"`
	Domain            string  `json:"domain"`
	Issuer            string  `json:"issuer"`
	Source            string  `json:"source"`
	ExpiresAt         *string `json:"expiresAt,omitempty"`
	AutoRenew         bool    `json:"autoRenew"`
	FingerprintSHA256 *string `json:"fingerprintSha256,omitempty"`
	CreatedAt         string  `json:"createdAt"`
}

func tlsCertToResponse(c *store.TLSCertificate) tlsCertResponse {
	out := tlsCertResponse{
		ID: c.ID, TenantID: c.TenantID, Domain: c.Domain, Issuer: c.Issuer, Source: c.Source,
		AutoRenew: c.AutoRenew, FingerprintSHA256: c.FingerprintSHA256,
		CreatedAt: c.CreatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
	}
	if c.ExpiresAt != nil {
		s := c.ExpiresAt.UTC().Format("2006-01-02T15:04:05.000Z")
		out.ExpiresAt = &s
	}
	return out
}

type tlsConfigResponse struct {
	TenantID       string          `json:"tenantId"`
	ACMEProvider   string          `json:"acmeProvider"`
	ACMEEmail      string          `json:"acmeEmail"`
	ACMEDirectory  *string         `json:"acmeDirectory,omitempty"`
	AllowedCiphers json.RawMessage `json:"allowedCiphers"`
	MinProtocol    string          `json:"minProtocol"`
	UpdatedAt      string          `json:"updatedAt"`
}

func tlsConfigToResponse(c *store.TLSConfig) tlsConfigResponse {
	return tlsConfigResponse{
		TenantID: c.TenantID, ACMEProvider: c.ACMEProvider, ACMEEmail: c.ACMEEmail,
		ACMEDirectory:  c.ACMEDirectory,
		AllowedCiphers: rawOrEmpty(c.AllowedCiphers, "[]"),
		MinProtocol:    c.MinProtocol,
		UpdatedAt:      c.UpdatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
	}
}

// ─── CA handlers ────────────────────────────────────────────────────────────

func handleListCAs(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		items, err := tx.ListCertAuthoritiesByTenant(r.Context(), tenant.ID)
		if err != nil {
			return rerr.Wrap(err, "list cas")
		}
		out := make([]caResponse, 0, len(items))
		for _, c := range items {
			out = append(out, caToResponse(c))
		}
		return rerr.JSON(w, map[string]any{"items": out, "total": len(out)})
	}
}

func handleCreateCA(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		var req struct {
			Name           string  `json:"name"`
			Kind           string  `json:"kind"`
			Subject        string  `json:"subject"`
			CertificatePEM string  `json:"certificatePem,omitempty"`
			PrivateKeyRef  *string `json:"privateKeyRef,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}
		if req.Name == "" || req.Kind == "" || req.Subject == "" {
			return rerr.Validation(map[string]string{"body": "name, kind, subject are required"})
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		created, err := tx.CreateCertAuthority(r.Context(), &store.CertAuthority{
			TenantID: tenant.ID, Name: req.Name, Kind: req.Kind, Subject: req.Subject,
			CertificatePEM: req.CertificatePEM, PrivateKeyRef: req.PrivateKeyRef,
		})
		if err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrCertAuthorityNameTaken) {
				return rerr.Conflict("A CA with that name already exists in this tenant", err)
			}
			return rerr.Wrap(err, "create ca")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		return rerr.JSONStatus(w, http.StatusCreated, caToResponse(created))
	}
}

func handleGetCA(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		c, err := tx.GetCertAuthority(r.Context(), tenant.ID, id)
		if err != nil {
			return rerr.NotFound("cert_authority", id)
		}
		return rerr.JSON(w, caToResponse(c))
	}
}

func handleUpdateCA(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		id := r.PathValue("id")
		var req struct {
			Name    *string `json:"name,omitempty"`
			Kind    *string `json:"kind,omitempty"`
			Subject *string `json:"subject,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		updated, err := tx.UpdateCertAuthority(r.Context(), tenant.ID, id, store.UpdateCertAuthorityParams{
			Name: req.Name, Kind: req.Kind, Subject: req.Subject,
		})
		if err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrCertAuthorityNotFound) {
				return rerr.NotFound("cert_authority", id)
			}
			return rerr.Wrap(err, "update ca")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		return rerr.JSON(w, caToResponse(updated))
	}
}

func handleDeleteCA(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		if err := tx.DeleteCertAuthority(r.Context(), tenant.ID, id); err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrCertAuthorityNotFound) {
				return rerr.NotFound("cert_authority", id)
			}
			return rerr.Wrap(err, "delete ca")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	}
}

// ─── Enrollment handlers ────────────────────────────────────────────────────

func handleListEnrollments(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		items, err := tx.ListCertEnrollmentsByTenant(r.Context(), tenant.ID)
		if err != nil {
			return rerr.Wrap(err, "list enrollments")
		}
		out := make([]enrollmentResponse, 0, len(items))
		for _, e := range items {
			out = append(out, enrollmentToResponse(e))
		}
		return rerr.JSON(w, map[string]any{"items": out, "total": len(out)})
	}
}

func handleCreateEnrollment(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		var req struct {
			CAID    *string         `json:"caId,omitempty"`
			Subject string          `json:"subject"`
			DNSSANs json.RawMessage `json:"dnsSans,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}
		if req.Subject == "" {
			return rerr.Validation(map[string]string{"subject": "subject is required"})
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		created, err := tx.CreateCertEnrollment(r.Context(), &store.CertEnrollment{
			TenantID: tenant.ID, CAID: req.CAID, Subject: req.Subject, DNSSANs: string(req.DNSSANs),
			RequestedAt: time.Now().UTC(),
		})
		if err != nil {
			_ = tx.Rollback()
			return rerr.Wrap(err, "create enrollment")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		return rerr.JSONStatus(w, http.StatusCreated, enrollmentToResponse(created))
	}
}

func handleGetEnrollment(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		e, err := tx.GetCertEnrollment(r.Context(), tenant.ID, id)
		if err != nil {
			return rerr.NotFound("cert_enrollment", id)
		}
		return rerr.JSON(w, enrollmentToResponse(e))
	}
}

func handleRevokeEnrollment(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		id := r.PathValue("id")
		var req struct {
			Reason string `json:"reason,omitempty"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		updated, err := tx.RevokeCertEnrollmentRow(r.Context(), tenant.ID, id, req.Reason)
		if err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrCertEnrollmentNotFound) {
				return rerr.NotFound("cert_enrollment", id)
			}
			return rerr.Wrap(err, "revoke enrollment")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		return rerr.JSON(w, enrollmentToResponse(updated))
	}
}

// ─── TLS Certificate handlers ───────────────────────────────────────────────

func handleListTLSCerts(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		items, err := tx.ListTLSCertificatesByTenant(r.Context(), tenant.ID)
		if err != nil {
			return rerr.Wrap(err, "list tls certs")
		}
		out := make([]tlsCertResponse, 0, len(items))
		for _, c := range items {
			out = append(out, tlsCertToResponse(c))
		}
		return rerr.JSON(w, map[string]any{"items": out, "total": len(out)})
	}
}

func handleCreateTLSCert(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		var req struct {
			Domain         string `json:"domain"`
			Issuer         string `json:"issuer,omitempty"`
			Source         string `json:"source,omitempty"`
			CertificatePEM string `json:"certificatePem,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}
		if req.Domain == "" {
			return rerr.Validation(map[string]string{"domain": "domain is required"})
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		created, err := tx.CreateTLSCertificate(r.Context(), &store.TLSCertificate{
			TenantID: tenant.ID, Domain: req.Domain, Issuer: req.Issuer, Source: req.Source,
			CertificatePEM: req.CertificatePEM, AutoRenew: true,
		})
		if err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrTLSCertificateTaken) {
				return rerr.Conflict("a certificate for that domain already exists", err)
			}
			return rerr.Wrap(err, "create tls cert")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		return rerr.JSONStatus(w, http.StatusCreated, tlsCertToResponse(created))
	}
}

func handleGetTLSCert(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		c, err := tx.GetTLSCertificate(r.Context(), tenant.ID, id)
		if err != nil {
			return rerr.NotFound("tls_certificate", id)
		}
		return rerr.JSON(w, tlsCertToResponse(c))
	}
}

func handleToggleAutoRenew(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		id := r.PathValue("id")
		var req struct {
			AutoRenew bool `json:"autoRenew"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		updated, err := tx.UpdateTLSCertificate(r.Context(), tenant.ID, id, store.UpdateTLSCertificateParams{AutoRenew: &req.AutoRenew})
		if err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrTLSCertificateNotFound) {
				return rerr.NotFound("tls_certificate", id)
			}
			return rerr.Wrap(err, "toggle auto-renew")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		return rerr.JSON(w, tlsCertToResponse(updated))
	}
}

func handleDeleteTLSCert(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		if err := tx.DeleteTLSCertificate(r.Context(), tenant.ID, id); err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrTLSCertificateNotFound) {
				return rerr.NotFound("tls_certificate", id)
			}
			return rerr.Wrap(err, "delete tls cert")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	}
}

// ─── TLS Config handlers ────────────────────────────────────────────────────

func handleGetTLSConfig(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		return handleReadConfig(w, r, st, "get tls config",
			func(ctx context.Context, tx store.Tx, tenantID string) (any, error) {
				c, err := tx.GetTLSConfig(ctx, tenantID)
				if err != nil {
					return nil, err
				}
				return tlsConfigToResponse(c), nil
			})
	}
}

func handleUpdateTLSACME(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		var req struct {
			Provider  string  `json:"provider"`
			Email     string  `json:"email,omitempty"`
			Directory *string `json:"directory,omitempty"`
		}
		return handleUpsertConfig(w, r, st, "update acme", &req,
			func(ctx context.Context, tx store.Tx, tenantID string) (any, error) {
				current, _ := tx.GetTLSConfig(ctx, tenantID)
				current.ACMEProvider = req.Provider
				current.ACMEEmail = req.Email
				current.ACMEDirectory = req.Directory
				current.TenantID = tenantID
				updated, err := tx.UpsertTLSConfig(ctx, current)
				if err != nil {
					return nil, err
				}
				return tlsConfigToResponse(updated), nil
			})
	}
}

func handleUpdateTLSCiphers(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		var req struct {
			AllowedCiphers json.RawMessage `json:"allowedCiphers"`
			MinProtocol    string          `json:"minProtocol,omitempty"`
		}
		return handleUpsertConfig(w, r, st, "update ciphers", &req,
			func(ctx context.Context, tx store.Tx, tenantID string) (any, error) {
				current, _ := tx.GetTLSConfig(ctx, tenantID)
				current.AllowedCiphers = string(req.AllowedCiphers)
				if req.MinProtocol != "" {
					current.MinProtocol = req.MinProtocol
				}
				current.TenantID = tenantID
				updated, err := tx.UpsertTLSConfig(ctx, current)
				if err != nil {
					return nil, err
				}
				return tlsConfigToResponse(updated), nil
			})
	}
}
