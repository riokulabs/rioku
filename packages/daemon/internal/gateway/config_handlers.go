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

	"github.com/riokulabs/rioku/internal/rerr"
	"github.com/riokulabs/rioku/internal/store"
)

// handleReadConfig wraps the "tenant -> read-tx -> fetch -> JSON 200" scaffold
// shared by every singleton-config GET handler. The fetch closure returns the
// already-shaped response payload.
func handleReadConfig(
	w http.ResponseWriter,
	r *http.Request,
	st store.Driver,
	errContext string,
	fetch func(ctx context.Context, tx store.Tx, tenantID string) (any, error),
) error {
	tenant, ok := tenantOrError(w, r)
	if !ok {
		return nil
	}
	tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
	defer func() { _ = tx.Rollback() }()
	resp, err := fetch(r.Context(), tx, tenant.ID)
	if err != nil {
		return rerr.Wrap(err, errContext)
	}
	return rerr.JSON(w, resp)
}

// handleUpsertConfig wraps the "tenant -> decode body -> write-tx -> writer ->
// commit -> JSON 200" scaffold shared by every singleton-config PUT handler.
func handleUpsertConfig(
	w http.ResponseWriter,
	r *http.Request,
	st store.Driver,
	errContext string,
	body any,
	write func(ctx context.Context, tx store.Tx, tenantID string) (any, error),
) error {
	tenant, ok := tenantOrError(w, r)
	if !ok {
		return nil
	}
	if body != nil {
		if err := json.NewDecoder(r.Body).Decode(body); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}
	}
	tx, _ := st.Begin(r.Context(), store.TxOptions{})
	resp, err := write(r.Context(), tx, tenant.ID)
	if err != nil {
		_ = tx.Rollback()
		return rerr.Wrap(err, errContext)
	}
	if err := tx.Commit(); err != nil {
		return rerr.Wrap(err, "commit")
	}
	return rerr.JSON(w, resp)
}
