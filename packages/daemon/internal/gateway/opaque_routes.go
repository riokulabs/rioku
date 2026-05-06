package gateway

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"time"

	"github.com/riokulabs/rioku/internal/store"
)

// RegisterOpaqueRoutes registers the opaque-handle endpoints:
//
//	POST /api/v1/t/{tenant}/opaque-handles
//	GET  /api/v1/t/{tenant}/opaque-handles/{handle}
func RegisterOpaqueRoutes(mux *http.ServeMux, st store.Driver) {
	mux.Handle("POST /api/v1/t/{tenant}/opaque-handles",
		RequirePermission("opaque:write")(http.HandlerFunc(handleRegisterOpaque(st))))
	mux.Handle("GET /api/v1/t/{tenant}/opaque-handles/{handle}",
		RequirePermission("opaque:read")(http.HandlerFunc(handleResolveOpaque(st))))
}

type registerOpaqueReq struct {
	Value string `json:"value"`
}

type opaqueResponse struct {
	Handle string `json:"handle"`
}

func handleRegisterOpaque(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenantID := r.PathValue("tenant")
		var req registerOpaqueReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Value == "" {
			writeProblem(w, 400, "https://rioku.dev/errors/validation-failed",
				"Validation failed", "value is required", r.URL.Path, nil)
			return
		}

		hash := sha256.Sum256([]byte(req.Value))
		valueHash := hex.EncodeToString(hash[:])

		ctx := r.Context()
		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			writeProblem(w, 500, "https://rioku.dev/errors/internal",
				"Internal server error", "begin tx", r.URL.Path, nil)
			return
		}
		defer func() { _ = tx.Rollback() }()

		// Idempotent: same (tenant, value_hash) → same handle.
		if existing, err := tx.GetOpaqueHandleByValueHash(ctx, tenantID, valueHash); err == nil && existing != nil {
			_ = tx.Commit()
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(opaqueResponse{Handle: existing.Handle})
			return
		}

		// New handle: "oh_" + base64url of 10 random bytes (80 bits entropy).
		var rb [10]byte
		if _, err := rand.Read(rb[:]); err != nil {
			writeProblem(w, 500, "https://rioku.dev/errors/internal",
				"Internal server error", "random", r.URL.Path, nil)
			return
		}
		handle := "oh_" + base64.RawURLEncoding.EncodeToString(rb[:])

		if err := tx.UpsertOpaqueHandle(ctx, store.OpaqueHandle{
			Handle:    handle,
			TenantID:  tenantID,
			ValueHash: valueHash,
			CreatedAt: time.Now().UTC(),
		}); err != nil {
			writeProblem(w, 500, "https://rioku.dev/errors/internal",
				"Internal server error", "upsert", r.URL.Path, nil)
			return
		}
		if err := tx.Commit(); err != nil {
			writeProblem(w, 500, "https://rioku.dev/errors/internal",
				"Internal server error", "commit", r.URL.Path, nil)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(opaqueResponse{Handle: handle})
	}
}

func handleResolveOpaque(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenantID := r.PathValue("tenant")
		handle := r.PathValue("handle")

		ctx := r.Context()
		tx, err := st.Begin(ctx, store.TxOptions{ReadOnly: true})
		if err != nil {
			writeProblem(w, 500, "https://rioku.dev/errors/internal",
				"Internal server error", "begin tx", r.URL.Path, nil)
			return
		}
		defer func() { _ = tx.Rollback() }()

		got, err := tx.GetOpaqueHandle(ctx, tenantID, handle)
		if err != nil || got == nil {
			writeProblem(w, 404, "https://rioku.dev/errors/not-found",
				"Handle not found", "no opaque handle for this tenant", r.URL.Path, nil)
			return
		}
		_ = tx.Commit()

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"handle":    got.Handle,
			"tenantId":  got.TenantID,
			"createdAt": got.CreatedAt.UTC().Format(time.RFC3339),
		})
	}
}
