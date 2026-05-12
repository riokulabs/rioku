// Package gateway — certificate management endpoints (#84).
//
//	GET  /api/v1/certificates              list managed certificates
//	POST /api/v1/certificates/{id}/renew   force renewal
//	POST /api/v1/certificates/{id}/revoke  revoke a cert
//
// Reads require `certificates:read`; mutations require `certificates:manage`.
//
// Backed by a caddy.CertService implementation supplied by the daemon.
// Default is caddy.StubCertService — empty list + structured
// "not implemented yet" responses for renew/revoke. Full Caddy
// filesystem scan + admin-API renew/revoke integration lands alongside
// #77 (Caddy cert lifecycle audit).
package gateway

import (
	"errors"
	"net/http"

	"github.com/riokulabs/rioku/internal/caddy"
	"github.com/riokulabs/rioku/internal/rerr"
)

// RegisterCertificateRoutes registers the certificate management endpoints.
// Returns without registering anything when `svc` is nil so the gateway
// stays silent in deployments that haven't wired a cert service.
func RegisterCertificateRoutes(mux *http.ServeMux, svc caddy.CertService) {
	if svc == nil {
		return
	}
	mux.Handle("GET /api/v1/certificates",
		RequirePermission("certificates:read")(rerr.H(handleListCertificates(svc))))
	mux.Handle("POST /api/v1/certificates/{id}/renew",
		RequirePermission("certificates:manage")(rerr.H(handleRenewCertificate(svc))))
	mux.Handle("POST /api/v1/certificates/{id}/revoke",
		RequirePermission("certificates:manage")(rerr.H(handleRevokeCertificate(svc))))
}

func handleListCertificates(svc caddy.CertService) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		certs, err := svc.ListCertificates(r.Context())
		if err != nil {
			return rerr.Wrap(err, "list certificates")
		}
		if certs == nil {
			certs = []caddy.Certificate{}
		}
		return rerr.JSON(w, map[string]any{
			"items": certs,
			"total": len(certs),
		})
	}
}

func handleRenewCertificate(svc caddy.CertService) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		id := r.PathValue("id")
		if id == "" {
			return rerr.Validation(map[string]string{"id": "certificate id is required"})
		}
		result, err := svc.RenewCertificate(r.Context(), id)
		if err != nil {
			if errors.Is(err, caddy.ErrCertNotFound) {
				return rerr.NotFound("certificate", id)
			}
			return rerr.Wrap(err, "renew certificate")
		}
		w.WriteHeader(http.StatusAccepted)
		return rerr.JSON(w, result)
	}
}

func handleRevokeCertificate(svc caddy.CertService) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		id := r.PathValue("id")
		if id == "" {
			return rerr.Validation(map[string]string{"id": "certificate id is required"})
		}
		result, err := svc.RevokeCertificate(r.Context(), id)
		if err != nil {
			if errors.Is(err, caddy.ErrCertNotFound) {
				return rerr.NotFound("certificate", id)
			}
			return rerr.Wrap(err, "revoke certificate")
		}
		w.WriteHeader(http.StatusAccepted)
		return rerr.JSON(w, result)
	}
}
