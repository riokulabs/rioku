// Package gateway — certificate management endpoints (#84).
//
//	GET  /api/v1/certificates              list managed certificates
//	POST /api/v1/certificates/{id}/renew   force renewal
//	POST /api/v1/certificates/{id}/revoke  revoke a cert
//
// Reads require `certificates:read`; mutations require `certificates:manage`.
//
// Backed by a caddy.CertService implementation supplied by the daemon.
// Stage-1 default is caddy.StubCertService — empty list + structured
// "not implemented yet" responses for renew/revoke. The full Caddy
// filesystem scan + admin-API renew/revoke integration lands in stage-2
// alongside #77 (Caddy cert lifecycle audit).
package gateway

import (
	"errors"
	"net/http"

	"github.com/riokulabs/rioku/internal/caddy"
)

// RegisterCertificateRoutes registers the certificate management endpoints.
// Returns without registering anything when `svc` is nil so the gateway
// stays silent in deployments that haven't wired a cert service.
func RegisterCertificateRoutes(mux *http.ServeMux, svc caddy.CertService) {
	if svc == nil {
		return
	}
	mux.Handle("GET /api/v1/certificates",
		RequirePermission("certificates:read")(http.HandlerFunc(handleListCertificates(svc))))
	mux.Handle("POST /api/v1/certificates/{id}/renew",
		RequirePermission("certificates:manage")(http.HandlerFunc(handleRenewCertificate(svc))))
	mux.Handle("POST /api/v1/certificates/{id}/revoke",
		RequirePermission("certificates:manage")(http.HandlerFunc(handleRevokeCertificate(svc))))
}

func handleListCertificates(svc caddy.CertService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		certs, err := svc.ListCertificates(r.Context())
		if err != nil {
			writeInternalError(w, r, "list certificates")
			return
		}
		if certs == nil {
			certs = []caddy.Certificate{}
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"items": certs,
			"total": len(certs),
		})
	}
}

func handleRenewCertificate(svc caddy.CertService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if id == "" {
			writeBadRequest(w, r, "certificate id is required")
			return
		}
		result, err := svc.RenewCertificate(r.Context(), id)
		if err != nil {
			if errors.Is(err, caddy.ErrCertNotFound) {
				writeProblem(w, http.StatusNotFound, errTypeValidation, "Not found",
					"Certificate not found.", r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "renew certificate")
			return
		}
		writeJSON(w, http.StatusAccepted, result)
	}
}

func handleRevokeCertificate(svc caddy.CertService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if id == "" {
			writeBadRequest(w, r, "certificate id is required")
			return
		}
		result, err := svc.RevokeCertificate(r.Context(), id)
		if err != nil {
			if errors.Is(err, caddy.ErrCertNotFound) {
				writeProblem(w, http.StatusNotFound, errTypeValidation, "Not found",
					"Certificate not found.", r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "revoke certificate")
			return
		}
		writeJSON(w, http.StatusAccepted, result)
	}
}
