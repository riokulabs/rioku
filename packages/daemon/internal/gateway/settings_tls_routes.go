// Package gateway: manual TLS-cert upload endpoints (#191 / Plan 07-002).
//
//	POST   /api/v1/t/{tenant}/settings/tls/manual
//	DELETE /api/v1/t/{tenant}/settings/tls/manual/{certId}
//
// Manual certs are stored alongside ACME-issued certs in the per-tenant
// `tls_certificates` table — the existing schema already carries a
// `source` column with `manual | acme` semantics, so no migration is
// required. The POST handler validates the supplied PEM blobs (parses
// the cert chain, parses the key, runs `tls.X509KeyPair` to confirm the
// pair matches), persists the cert, and triggers a Caddy reload so the
// new material is picked up on the live listener.
package gateway

import (
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/riokulabs/rioku/internal/store"
)

// RegisterSettingsTLSRoutes wires the manual TLS cert upload + delete
// endpoints. Both require `tls:write` since either action mutates the
// active TLS material.
func RegisterSettingsTLSRoutes(mux *http.ServeMux, st store.Driver) {
	mux.Handle("POST /api/v1/t/{tenant}/settings/tls/manual",
		RequirePermission("tls:write")(http.HandlerFunc(handleUploadManualCert(st))))
	mux.Handle("DELETE /api/v1/t/{tenant}/settings/tls/manual/{certId}",
		RequirePermission("tls:write")(http.HandlerFunc(handleDeleteManualCert(st))))
}

type manualCertRequest struct {
	CertPEM   string `json:"cert_pem"`
	KeyPEM    string `json:"key_pem"`
	AutoRenew bool   `json:"auto_renew,omitempty"`
}

// manualCertResponse mirrors the contract documented in Plan 07-002: the
// frontend stores `cert_id` to support the subsequent DELETE call, plus
// the parsed metadata for the visible "uploaded certs" list.
type manualCertResponse struct {
	CertID            string   `json:"cert_id"`
	Ref               certRef  `json:"ref"`
	SHA256Fingerprint string   `json:"sha256_fingerprint"`
	ExpiresAt         string   `json:"expires_at"`
	Subject           string   `json:"subject"`
	SANs              []string `json:"sans"`
}

// certRef matches `SettingsTLSManualCertRefsItem` in the OpenAPI surface
// — the frontend `<TlsRealSection>` adds the returned ref straight into
// the tls/config `manualCertRefs` list without going through a refetch.
type certRef struct {
	ID        string   `json:"id"`
	Subject   string   `json:"subject"`
	ExpiresAt string   `json:"expiresAt"`
	SANs      []string `json:"sans"`
	AutoRenew bool     `json:"autoRenew"`
}

func handleUploadManualCert(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		var req manualCertRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeBadRequest(w, r, "invalid JSON body")
			return
		}
		if strings.TrimSpace(req.CertPEM) == "" || strings.TrimSpace(req.KeyPEM) == "" {
			writeBadRequest(w, r, "cert_pem and key_pem are required")
			return
		}

		// Parse the cert chain and pull metadata from the leaf.
		leaf, err := parseLeafCert(req.CertPEM)
		if err != nil {
			writeBadRequest(w, r, "invalid cert PEM: "+err.Error())
			return
		}
		// Confirm the supplied key matches the cert via tls.X509KeyPair —
		// this is the standard way Go enforces "this private key signs
		// this cert"; mismatches surface as a 400 rather than landing in
		// the store.
		if _, err := tls.X509KeyPair([]byte(req.CertPEM), []byte(req.KeyPEM)); err != nil {
			writeBadRequest(w, r, "cert/key mismatch: "+err.Error())
			return
		}

		fp := sha256.Sum256(leaf.Raw)
		fpHex := hex.EncodeToString(fp[:])
		expiresAt := leaf.NotAfter.UTC()
		expiresStr := expiresAt.Format("2006-01-02T15:04:05.000Z")
		// `domain` (NOT NULL UNIQUE per tenant in the existing schema)
		// is the cert's common-name; we fall back to the first SAN when
		// CN is empty (modern certs frequently are).
		domain := strings.TrimSpace(leaf.Subject.CommonName)
		if domain == "" && len(leaf.DNSNames) > 0 {
			domain = leaf.DNSNames[0]
		}
		if domain == "" {
			writeBadRequest(w, r, "cert has no CommonName or DNS SANs to use as domain")
			return
		}

		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		issuer := strings.TrimSpace(leaf.Issuer.CommonName)
		if issuer == "" {
			issuer = "manual"
		}
		created, err := tx.CreateTLSCertificate(r.Context(), &store.TLSCertificate{
			TenantID:          tenant.ID,
			Domain:            domain,
			Issuer:            issuer,
			Source:            "manual",
			ExpiresAt:         &expiresAt,
			AutoRenew:         req.AutoRenew,
			FingerprintSHA256: &fpHex,
			CertificatePEM:    req.CertPEM,
		})
		if err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrTLSCertificateTaken) {
				writeProblem(w, http.StatusConflict, errTypeConflict, "Domain already in use",
					"A certificate for "+domain+" already exists", r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "create manual tls cert")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}

		// New material → ask Caddy to reload so the live listener can
		// pick the cert up on the next handshake.
		_ = triggerCaddyReload(r.Context(), "settings.tls.manual")

		ref := certRef{
			ID:        created.ID,
			Subject:   leaf.Subject.String(),
			ExpiresAt: expiresStr,
			SANs:      append([]string{}, leaf.DNSNames...),
			AutoRenew: created.AutoRenew,
		}
		writeJSON(w, http.StatusCreated, manualCertResponse{
			CertID:            created.ID,
			Ref:               ref,
			SHA256Fingerprint: fpHex,
			ExpiresAt:         expiresStr,
			Subject:           leaf.Subject.String(),
			SANs:              ref.SANs,
		})
	}
}

func handleDeleteManualCert(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		id := r.PathValue("certId")
		if id == "" {
			writeBadRequest(w, r, "certId path value is required")
			return
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		if err := tx.DeleteTLSCertificate(r.Context(), tenant.ID, id); err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrTLSCertificateNotFound) {
				writeProblem(w, http.StatusNotFound, errTypeNotFound, "Certificate not found",
					"No certificate with id "+id, r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "delete manual tls cert")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		_ = triggerCaddyReload(r.Context(), "settings.tls.manual")
		w.WriteHeader(http.StatusNoContent)
	}
}

// parseLeafCert walks the supplied PEM blob, extracts the first
// CERTIFICATE block, and parses it via x509.ParseCertificate. Trailing
// chain blocks are silently ignored — manual uploads typically only
// carry the leaf, but bundles are accepted for convenience.
func parseLeafCert(pemBlob string) (*x509.Certificate, error) {
	rest := []byte(pemBlob)
	for {
		var block *pem.Block
		block, rest = pem.Decode(rest)
		if block == nil {
			return nil, fmt.Errorf("no CERTIFICATE PEM block found")
		}
		if block.Type != "CERTIFICATE" {
			continue
		}
		return x509.ParseCertificate(block.Bytes)
	}
}
