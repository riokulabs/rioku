package gateway

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"time"

	"github.com/riokulabs/rioku/internal/rerr"
	"github.com/riokulabs/rioku/internal/store"
)

// RegisterOpaqueRoutes registers the opaque-handle endpoints:
//
//	POST /api/v1/t/{tenant}/opaque-handles
//	GET  /api/v1/t/{tenant}/opaque-handles/{handle}
func RegisterOpaqueRoutes(mux *http.ServeMux, st store.Driver) {
	mux.Handle("POST /api/v1/t/{tenant}/opaque-handles",
		RequirePermission("opaque:write")(rerr.H(handleRegisterOpaque(st))))
	mux.Handle("GET /api/v1/t/{tenant}/opaque-handles/{handle}",
		RequirePermission("opaque:read")(rerr.H(handleResolveOpaque(st))))
}

type registerOpaqueReq struct {
	Value string `json:"value"`
}

type opaqueResponse struct {
	Handle string `json:"handle"`
}

func handleRegisterOpaque(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenantID := r.PathValue("tenant")
		var req registerOpaqueReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Value == "" {
			return rerr.Validation(map[string]string{"value": "value is required"})
		}

		hash := sha256.Sum256([]byte(req.Value))
		valueHash := hex.EncodeToString(hash[:])

		ctx := r.Context()
		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		// Idempotent: same (tenant, value_hash) → same handle.
		if existing, err := tx.GetOpaqueHandleByValueHash(ctx, tenantID, valueHash); err == nil && existing != nil {
			_ = tx.Commit()
			return rerr.JSONStatus(w, http.StatusCreated, opaqueResponse{Handle: existing.Handle})
		}

		// New handle: "oh_" + base64url of 10 random bytes (80 bits entropy).
		var rb [10]byte
		if _, err := rand.Read(rb[:]); err != nil {
			return rerr.Wrap(err, "random")
		}
		handle := "oh_" + base64.RawURLEncoding.EncodeToString(rb[:])

		if err := tx.UpsertOpaqueHandle(ctx, store.OpaqueHandle{
			Handle:    handle,
			TenantID:  tenantID,
			ValueHash: valueHash,
			CreatedAt: time.Now().UTC(),
		}); err != nil {
			return rerr.Wrap(err, "upsert")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}

		return rerr.JSONStatus(w, http.StatusCreated, opaqueResponse{Handle: handle})
	}
}

func handleResolveOpaque(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenantID := r.PathValue("tenant")
		handle := r.PathValue("handle")

		ctx := r.Context()
		tx, err := st.Begin(ctx, store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		got, err := tx.GetOpaqueHandle(ctx, tenantID, handle)
		if err != nil || got == nil {
			return rerr.NotFound("opaque_handle", handle)
		}
		_ = tx.Commit()

		return rerr.JSON(w, map[string]any{
			"handle":    got.Handle,
			"tenantId":  got.TenantID,
			"createdAt": got.CreatedAt.UTC().Format(time.RFC3339),
		})
	}
}
