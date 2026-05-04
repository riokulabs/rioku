// Package gateway: shared scaffolds for tenant-scoped singleton config
// handlers (settings, notifications, pki, ...).
//
// Every singleton-config GET/PUT handler does the same boilerplate:
//
//  1. Resolve the request tenant; bail if missing.
//  2. Open a read- or write-tx.
//  3. Call the dialect-agnostic store getter / writer.
//  4. Render the typed response (or write 204 No Content).
//
// `handleReadConfig` and `handleUpsertConfig` capture this scaffold; each
// caller supplies (a) the per-config fetch/write closure and (b) an error
// context string so per-config error logging stays specific.
package gateway

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/riokulabs/rioku/internal/store"
)

// handleReadConfig wraps the "tenant -> read-tx -> fetch -> JSON 200" scaffold
// shared by every singleton-config GET handler. The fetch closure returns the
// already-shaped response payload (matches the existing inline pattern of
// `writeJSON(w, 200, somethingToResponse(c))`).
//
// errContext is passed through to writeInternalError on the fetch failure path
// so each call site keeps its existing error-log breadcrumb (e.g.
// "get network_config", "get tls config").
func handleReadConfig(
	w http.ResponseWriter,
	r *http.Request,
	st store.Driver,
	errContext string,
	fetch func(ctx context.Context, tx store.Tx, tenantID string) (any, error),
) {
	tenant, ok := tenantOrError(w, r)
	if !ok {
		return
	}
	tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
	defer func() { _ = tx.Rollback() }()
	resp, err := fetch(r.Context(), tx, tenant.ID)
	if err != nil {
		writeInternalError(w, r, errContext)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// handleUpsertConfig wraps the "tenant -> decode body -> write-tx -> writer ->
// commit -> JSON 200" scaffold shared by every singleton-config PUT handler.
// The decoder is pre-allocated by the caller; the writer closure performs the
// actual store mutation and returns the already-shaped response payload.
//
// errContext is passed through to writeInternalError on the writer failure
// path so each call site keeps its existing error-log breadcrumb. The commit
// failure path always logs with the literal "commit" context (matches the
// pre-existing inline pattern).
func handleUpsertConfig(
	w http.ResponseWriter,
	r *http.Request,
	st store.Driver,
	errContext string,
	body any,
	write func(ctx context.Context, tx store.Tx, tenantID string) (any, error),
) {
	tenant, ok := tenantOrError(w, r)
	if !ok {
		return
	}
	if body != nil {
		if err := json.NewDecoder(r.Body).Decode(body); err != nil {
			writeBadRequest(w, r, "invalid JSON body")
			return
		}
	}
	tx, _ := st.Begin(r.Context(), store.TxOptions{})
	resp, err := write(r.Context(), tx, tenant.ID)
	if err != nil {
		_ = tx.Rollback()
		writeInternalError(w, r, errContext)
		return
	}
	if err := tx.Commit(); err != nil {
		writeInternalError(w, r, "commit")
		return
	}
	writeJSON(w, http.StatusOK, resp)
}
