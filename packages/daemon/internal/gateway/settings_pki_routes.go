// Package gateway: PKI revocation list endpoints (#191).
//
//	GET  /api/v1/t/{tenant}/settings/pki/revocations
//	POST /api/v1/t/{tenant}/settings/pki/revocations
//
// Revocations are sourced from the existing per-tenant `cert_enrollments`
// table — each row that has reached `state=revoked` carries the serial
// (its row id), the revocation reason, and the revocation timestamp.
// POST creates a synthetic revocation row (state=revoked from birth) so
// operators can record an out-of-band revocation event for a cert that
// was never minted through the daemon's enrollment flow.
package gateway

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/riokulabs/rioku/internal/store"
)

func RegisterSettingsPKIRoutes(mux *http.ServeMux, st store.Driver) {
	mux.Handle("GET /api/v1/t/{tenant}/settings/pki/revocations",
		RequirePermission("settings:read")(http.HandlerFunc(handleListRevocations(st))))
	mux.Handle("POST /api/v1/t/{tenant}/settings/pki/revocations",
		RequirePermission("settings:write")(http.HandlerFunc(handleCreateRevocation(st))))
}

type revocationItem struct {
	CertID    string `json:"cert_id"`
	Serial    string `json:"serial"`
	Subject   string `json:"subject"`
	RevokedAt string `json:"revoked_at"`
	Reason    string `json:"reason"`
}

type revocationListResponse struct {
	Items []revocationItem `json:"items"`
}

func handleListRevocations(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		rows, err := tx.ListCertEnrollmentsByTenant(r.Context(), tenant.ID)
		if err != nil {
			writeInternalError(w, r, "list revocations")
			return
		}
		out := make([]revocationItem, 0)
		for _, e := range rows {
			if e.State != "revoked" || e.RevokedAt == nil {
				continue
			}
			reason := ""
			if e.RevocationReason != nil {
				reason = *e.RevocationReason
			}
			out = append(out, revocationItem{
				CertID:    e.ID,
				Serial:    e.ID, // serial == enrollment row id in the daemon's PKI model
				Subject:   e.Subject,
				RevokedAt: e.RevokedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
				Reason:    reason,
			})
		}
		writeJSON(w, http.StatusOK, revocationListResponse{Items: out})
	}
}

type createRevocationRequest struct {
	Serial  string `json:"serial"`
	Reason  string `json:"reason"`
	Subject string `json:"subject,omitempty"`
}

func handleCreateRevocation(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		var req createRevocationRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeBadRequest(w, r, "invalid JSON body")
			return
		}
		req.Serial = strings.TrimSpace(req.Serial)
		req.Reason = strings.TrimSpace(req.Reason)
		if req.Serial == "" {
			writeBadRequest(w, r, "serial is required")
			return
		}
		if req.Reason == "" {
			writeBadRequest(w, r, "reason is required")
			return
		}

		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		// Resolve serial → enrollment row. If the operator supplied a
		// serial the daemon doesn't know about we accept it and stash a
		// freshly-minted enrollment in `revoked` state so the surface
		// stays consistent.
		existing, err := tx.GetCertEnrollment(r.Context(), tenant.ID, req.Serial)
		if err == nil && existing != nil {
			updated, revErr := tx.RevokeCertEnrollmentRow(r.Context(), tenant.ID, existing.ID, req.Reason)
			if revErr != nil {
				_ = tx.Rollback()
				writeInternalError(w, r, "revoke enrollment")
				return
			}
			if err := tx.Commit(); err != nil {
				writeInternalError(w, r, "commit")
				return
			}
			writeJSON(w, http.StatusOK, revocationToItem(updated))
			return
		}
		// Serial unknown → create a synthetic enrollment row so the
		// revocation surfaces in the list endpoint.
		subject := req.Subject
		if subject == "" {
			subject = "CN=" + req.Serial
		}
		now := time.Now().UTC()
		reason := req.Reason
		row := &store.CertEnrollment{
			ID:               req.Serial,
			TenantID:         tenant.ID,
			Subject:          subject,
			DNSSANs:          "[]",
			State:            "revoked",
			RequestedAt:      now,
			RevokedAt:        &now,
			RevocationReason: &reason,
		}
		created, err := tx.CreateCertEnrollment(r.Context(), row)
		if err != nil {
			_ = tx.Rollback()
			writeInternalError(w, r, "create revocation")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusCreated, revocationToItem(created))
	}
}

func revocationToItem(e *store.CertEnrollment) revocationItem {
	reason := ""
	if e.RevocationReason != nil {
		reason = *e.RevocationReason
	}
	revoked := ""
	if e.RevokedAt != nil {
		revoked = e.RevokedAt.UTC().Format("2006-01-02T15:04:05.000Z")
	}
	return revocationItem{
		CertID:    e.ID,
		Serial:    e.ID,
		Subject:   e.Subject,
		RevokedAt: revoked,
		Reason:    reason,
	}
}
