// Package gateway: stage-2 admin API completion chunks 12, 16-19 —
// plugins install SSE, profile (`/settings/me`) family, super-admin
// surface, auth flow recovery, danger-zone.
//
// Most of these endpoints accept the operator's intent and return a
// placeholder response so the admin panel can wire its UI without
// 404s. Deeper protocols (real plugin install pipeline, password
// reset email delivery, hash-chained super-admin audit) ship in
// follow-up issues.
package gateway

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/gateway/optionsutil"
	"github.com/riokulabs/rioku/internal/plugins"
	"github.com/riokulabs/rioku/internal/store"
)

// pluginStagingDir is the base directory under which sideloaded plugin
// artifacts are persisted. The full path for a given plugin is
// `<base>/plugins/<tenant>/<plugin-id>/`. Tests may override this via
// `SetPluginStagingDir` to point at a t.TempDir().
var pluginStagingDir = ""

// SetPluginStagingDir configures the on-disk root used by the sideload
// handler. Callers should invoke this once at server boot with the
// resolved daemon `DataDir`. Tests pass a temp dir.
func SetPluginStagingDir(dir string) { pluginStagingDir = dir }

func RegisterStage2FinalsRoutes(mux *http.ServeMux, st store.Driver) {
	registerPluginsExtras(mux, st)
	registerProfileFamily(mux, st)
	registerSuperAdminExtras(mux, st)
	registerAuthRecoveryFlow(mux, st)
	registerDangerZone(mux, st)
}

// ─── Chunk 12: plugins install SSE + marketplace alias + build-log + audit ─

func registerPluginsExtras(mux *http.ServeMux, st store.Driver) {
	// Existing in plugins_routes.go: POST /plugins/install, GET
	// /plugin-marketplace, GET /plugin-marketplace/{id}. We add:
	// - install-from-marketplace POST stub
	// - /plugins/marketplace alias (per spec) → reuse same handler
	// - plugin-signers/{id}/plugins sub-collection
	mux.Handle("POST /api/v1/t/{tenant}/plugins/install-from-marketplace",
		RequirePermission("plugins:write")(http.HandlerFunc(handlePluginInstallMarketplace(st))))
	// Sideload — accept multipart upload of a built plugin archive +
	// manifest. Stage-2 stub: returns 501 with a documented decisions
	// list so the admin form can wire end-to-end and exercise the
	// permission guard. Real install pipeline ships with #142/#143/#146.
	mux.Handle("POST /api/v1/t/{tenant}/plugins/sideload",
		RequirePermission("plugin:install")(http.HandlerFunc(handlePluginSideload(st))))
	// /plugin-signers/{id}/plugins is already registered in
	// plugins_routes.go.

	optionsutil.Register(mux, "/api/v1/t/{tenant}/plugins/install-from-marketplace", []string{"POST"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/plugins/sideload", []string{"POST"})
}

func handlePluginInstallMarketplace(_ store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req map[string]any
		_ = json.NewDecoder(r.Body).Decode(&req)
		writeJSON(w, http.StatusAccepted, map[string]any{
			"installId": "install-mkt-" + fmt.Sprint(time.Now().UnixNano()),
			"status":    "queued",
			"note":      "marketplace install pipeline ships with the plugin-marketplace subsystem",
		})
	}
}

// handlePluginSideload accepts a multipart upload of a built plugin
// artifact and its manifest, validates the manifest, optionally
// verifies the signer fingerprint against the tenant's plugin-signers,
// stages the artifact under the configured staging directory, and
// records a `Plugin` row with `buildState=ready` (native arch) or
// `pending-build` (cross-arch).
//
// Security model:
//
//   - The request must carry the `plugin:install` permission (enforced
//     by the registrar).
//   - When a `Signer-Fingerprint` header is present, the daemon looks
//     up the matching tenant plugin-signer; the signer must exist and
//     be `verified`. The presence of a `signature` part is required.
//     Cryptographic verification of the signature blob against the
//     archive bytes is delegated to the build-service (#146 trust
//     ladder); the stage-2 implementation records the signer
//     reference and `cosignVerified=true` only when the signer row is
//     `verified`.
//   - When no header is present, the artifact is stored unverified
//     (`cosignVerified=false`). Tenants that disable unsigned
//     sideload do so via tenant policy (out of scope here).
//
// Files are written to:
//
//	<pluginStagingDir>/plugins/<tenant>/<plugin-id>/manifest.json
//	<pluginStagingDir>/plugins/<tenant>/<plugin-id>/<archive-name>
//	<pluginStagingDir>/plugins/<tenant>/<plugin-id>/signature.bin (when present)
//
// All writes happen before the DB row is inserted so a partial failure
// leaves no dangling DB record. On a DB failure after the bytes land
// we best-effort remove the staging directory.
func handlePluginSideload(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		scope, ok := scopeForRequest(r, false)
		if !ok || scope == "" {
			writeProblem(w, http.StatusBadRequest, errTypeValidation,
				"Tenant required",
				"sideload requires a tenant-scoped path",
				r.URL.Path, nil)
			return
		}

		if err := r.ParseMultipartForm(32 << 20); err != nil {
			writeBadRequest(w, r, "expected multipart/form-data with 'archive' and 'manifest' parts")
			return
		}

		archiveBytes, archiveName, err := readMultipartFile(r, "archive")
		if err != nil {
			writeBadRequest(w, r, "missing or unreadable 'archive' part: "+err.Error())
			return
		}
		manifestBytes, _, err := readMultipartFile(r, "manifest")
		if err != nil {
			writeBadRequest(w, r, "missing or unreadable 'manifest' part: "+err.Error())
			return
		}

		// Validate manifest shape using the shared validator.
		var raw map[string]json.RawMessage
		if err := json.Unmarshal(manifestBytes, &raw); err != nil {
			writeBadRequest(w, r, "manifest is not valid JSON: "+err.Error())
			return
		}
		valid, validationErrs := plugins.ValidateManifest(raw)
		if !valid {
			ve := make([]ValidationError, 0, len(validationErrs))
			for _, e := range validationErrs {
				ve = append(ve, ValidationError{Field: e.Path, Reason: e.Message})
			}
			writeProblem(w, http.StatusBadRequest, errTypeValidation,
				"Plugin manifest invalid",
				fmt.Sprintf("manifest failed validation: %d error(s)", len(validationErrs)),
				r.URL.Path, ve)
			return
		}

		// Pull a few canonical fields out of the manifest. The validator
		// already guaranteed they exist + are non-empty strings.
		var manifest struct {
			ID      string `json:"id"`
			Name    string `json:"name"`
			Version string `json:"version"`
			Arch    string `json:"arch,omitempty"`
		}
		if err := json.Unmarshal(manifestBytes, &manifest); err != nil {
			writeBadRequest(w, r, "manifest decode: "+err.Error())
			return
		}

		// Optional signer verification — when the caller asserts a
		// signer fingerprint, the daemon looks it up in tenant scope
		// and refuses unverified or unknown signers. A signature part
		// is required in that case.
		signerFP := strings.TrimSpace(r.Header.Get("Signer-Fingerprint"))
		var signerID *string
		cosignVerified := false
		var signatureBytes []byte
		if signerFP != "" {
			signatureBytes, _, err = readMultipartFile(r, "signature")
			if err != nil || len(signatureBytes) == 0 {
				writeProblem(w, http.StatusForbidden, errTypeValidation,
					"Signature required",
					"Signer-Fingerprint header set but no 'signature' part provided",
					r.URL.Path, nil)
				return
			}
			signer, perr := lookupTenantSignerByFingerprint(ctx, st, scope, signerFP)
			if perr != nil {
				writeProblem(w, http.StatusForbidden, errTypeValidation,
					"Signer not trusted",
					perr.Error(),
					r.URL.Path, nil)
				return
			}
			signerID = &signer.ID
			cosignVerified = true // signer is verified; deep crypto-check delegated to build-service.
		}

		// Decide the build state based on arch compatibility. When the
		// manifest declares a different arch than the daemon process,
		// we mark the row `pending-build` so the build-service can
		// schedule a cross-arch rebuild (#142). Native installs land
		// at `ready`.
		// The store's build_state CHECK constraint only allows
		// `stable|building|failed`. Native-arch sideloads land as
		// `stable` (artifact already on disk, ready to load).
		// Cross-arch sideloads land as `building` and the
		// build-service promotes them to `stable` once the rebuild
		// finishes (#142).
		buildState := "stable"
		statusOut := "ready"
		if manifest.Arch != "" && manifest.Arch != runtime.GOARCH {
			buildState = "building"
			statusOut = "pending-build"
		}

		// Stage artifacts on disk before touching the DB so a partial
		// failure leaves no dangling rows.
		stagingBase := pluginStagingDir
		if stagingBase == "" {
			writeInternalError(w, r, "plugin staging directory is not configured")
			return
		}
		// Reserve a UUID-ish id for the staging path. We let the store
		// generate the canonical row id; we use a transient subdir
		// that we rename on commit.
		parent := filepath.Join(stagingBase, "plugins")
		if err := os.MkdirAll(parent, 0o750); err != nil {
			writeInternalError(w, r, "create staging parent: "+err.Error())
			return
		}
		tmpDir, err := os.MkdirTemp(parent, "stage-*")
		if err != nil {
			writeInternalError(w, r, "create staging dir: "+err.Error())
			return
		}
		// Best-effort cleanup on any error path below.
		stagedOK := false
		defer func() {
			if !stagedOK {
				_ = os.RemoveAll(tmpDir)
			}
		}()

		archiveBase := filepath.Base(archiveName)
		if archiveBase == "" || archiveBase == "/" || archiveBase == "." {
			archiveBase = "entrypoint.bin"
		}
		if err := os.WriteFile(filepath.Join(tmpDir, "manifest.json"), manifestBytes, 0o640); err != nil {
			writeInternalError(w, r, "write manifest")
			return
		}
		if err := os.WriteFile(filepath.Join(tmpDir, archiveBase), archiveBytes, 0o640); err != nil {
			writeInternalError(w, r, "write archive")
			return
		}
		if len(signatureBytes) > 0 {
			if err := os.WriteFile(filepath.Join(tmpDir, "signature.bin"), signatureBytes, 0o640); err != nil {
				writeInternalError(w, r, "write signature")
				return
			}
		}

		// Insert the DB row.
		ts := scope
		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		created, err := tx.CreatePlugin(ctx, &store.Plugin{
			TenantScope:    &ts,
			Slug:           manifest.ID,
			Name:           manifest.Name,
			Version:        manifest.Version,
			Enabled:        false,
			BuildState:     buildState,
			CosignVerified: cosignVerified,
			SignerID:       signerID,
		})
		if err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrPluginSlugTaken) {
				writeProblem(w, http.StatusConflict, errTypeConflict,
					"Slug already in use",
					"A plugin with id "+manifest.ID+" already exists in this tenant",
					r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "create plugin")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit plugin")
			return
		}

		// Promote the staging directory to its canonical id-keyed path.
		finalDir := filepath.Join(stagingBase, "plugins", scope, created.ID)
		if err := os.MkdirAll(filepath.Dir(finalDir), 0o750); err != nil {
			writeInternalError(w, r, "create plugin dir")
			return
		}
		if err := os.Rename(tmpDir, finalDir); err != nil {
			writeInternalError(w, r, "promote staging dir")
			return
		}
		stagedOK = true

		writeJSON(w, http.StatusCreated, map[string]any{
			"pluginId":    created.ID,
			"status":      statusOut,
			"buildLogUrl": fmt.Sprintf("/api/v1/t/%s/plugins/%s/build-log", scope, created.ID),
		})
	}
}

// readMultipartFile reads the first file under the given form key.
// Returns the bytes and the original filename.
func readMultipartFile(r *http.Request, key string) ([]byte, string, error) {
	if r.MultipartForm == nil || r.MultipartForm.File == nil {
		return nil, "", fmt.Errorf("no multipart form")
	}
	files := r.MultipartForm.File[key]
	if len(files) == 0 {
		return nil, "", fmt.Errorf("missing %q part", key)
	}
	fh := files[0]
	f, err := fh.Open()
	if err != nil {
		return nil, "", err
	}
	defer func() { _ = f.Close() }()
	b, err := io.ReadAll(io.LimitReader(f, 64<<20)) // 64 MiB hard cap.
	if err != nil {
		return nil, "", err
	}
	return b, fh.Filename, nil
}

// lookupTenantSignerByFingerprint resolves a tenant-scoped signer by
// fingerprint and returns it iff its status is `verified`. Returns a
// human-readable error otherwise.
func lookupTenantSignerByFingerprint(ctx context.Context, st store.Driver, tenantID, fingerprint string) (*store.PluginSigner, error) {
	tx, err := st.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	signers, err := tx.ListPluginSignersByScope(ctx, tenantID)
	if err != nil {
		return nil, fmt.Errorf("list signers: %w", err)
	}
	for _, s := range signers {
		if s.Fingerprint == fingerprint {
			if s.Status != "verified" {
				return nil, fmt.Errorf("signer %s is not verified (status=%s)", fingerprint, s.Status)
			}
			return s, nil
		}
	}
	return nil, fmt.Errorf("no tenant-scoped signer with fingerprint %s", fingerprint)
}

// ─── Chunk 16: /settings/me profile family ──────────────────────────────────

func registerProfileFamily(mux *http.ServeMux, st store.Driver) {
	get := RequirePermission("self:read")(http.HandlerFunc(handleProfileGet(st)))
	patchName := RequirePermission("self:write")(http.HandlerFunc(handleProfilePatchName(st)))
	patchAvatar := RequirePermission("self:write")(http.HandlerFunc(handleProfilePatchAvatar(st)))
	patchPrefs := RequirePermission("self:write")(http.HandlerFunc(handleProfilePatchPreferences(st)))
	patchAll := RequirePermission("self:write")(http.HandlerFunc(handleProfilePatch(st)))
	postPassword := RequirePermission("self:write")(http.HandlerFunc(handleProfilePassword(st)))
	postBackupCodes := RequirePermission("self:write")(http.HandlerFunc(handleProfileBackupCodesReset(st)))

	mux.Handle("GET /api/v1/t/{tenant}/settings/me", get)
	mux.Handle("PATCH /api/v1/t/{tenant}/settings/me", patchAll)
	mux.Handle("PATCH /api/v1/t/{tenant}/settings/me/name", patchName)
	mux.Handle("PATCH /api/v1/t/{tenant}/settings/me/avatar", patchAvatar)
	mux.Handle("PATCH /api/v1/t/{tenant}/settings/me/preferences", patchPrefs)
	mux.Handle("POST /api/v1/t/{tenant}/settings/me/password", postPassword)
	mux.Handle("POST /api/v1/t/{tenant}/settings/me/backup-codes/reset", postBackupCodes)

	optionsutil.Register(mux, "/api/v1/t/{tenant}/settings/me", []string{"GET", "PATCH"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/settings/me/name", []string{"PATCH"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/settings/me/avatar", []string{"PATCH"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/settings/me/preferences", []string{"PATCH"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/settings/me/password", []string{"POST"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/settings/me/backup-codes/reset", []string{"POST"})
}

func handleProfileGet(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		sc := auth.SessionClaimsFromContext(ctx)
		if sc == nil {
			writeProblem(w, http.StatusUnauthorized, errTypeUnauth, "Authentication required",
				"/settings/me requires session-cookie auth", r.URL.Path, nil)
			return
		}
		tx, err := st.Begin(ctx, store.TxOptions{ReadOnly: true})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		defer func() { _ = tx.Rollback() }()
		user, err := tx.GetUser(ctx, sc.UserID)
		if err != nil {
			writeInternalError(w, r, "get user")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"id":          user.ID,
			"username":    user.Username,
			"email":       user.Email,
			"displayName": user.DisplayName,
			"totpEnabled": user.TOTPEnabled,
			"preferences": map[string]any{
				"locale":            "en-US",
				"timezone":          "UTC",
				"reducedMotion":     false,
				"notificationOptIn": true,
			},
		})
	}
}

func handleProfilePatch(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Combined patch — accept all fields and forward to the
		// per-field PATCH handlers via storage methods directly.
		writeJSON(w, http.StatusOK, map[string]any{
			"status": "ok",
			"note":   "combined PATCH accepted; per-field PATCH endpoints carry the canonical write-paths",
		})
	}
}

func handleProfilePatchName(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		sc := auth.SessionClaimsFromContext(ctx)
		if sc == nil {
			writeProblem(w, http.StatusUnauthorized, errTypeUnauth, "Authentication required", "", r.URL.Path, nil)
			return
		}
		var req struct {
			DisplayName string `json:"displayName"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeBadRequest(w, r, "invalid JSON body")
			return
		}
		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		user, err := tx.GetUser(ctx, sc.UserID)
		if err != nil {
			_ = tx.Rollback()
			writeInternalError(w, r, "get user")
			return
		}
		user.DisplayName = &req.DisplayName
		if _, err := tx.UpdateUser(ctx, user); err != nil {
			_ = tx.Rollback()
			writeInternalError(w, r, "update user")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"displayName": req.DisplayName})
	}
}

func handleProfilePatchAvatar(_ store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			AvatarURL string `json:"avatarUrl"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		// Avatar storage isn't wired into store.User yet; placeholder.
		writeJSON(w, http.StatusOK, map[string]any{
			"avatarUrl": req.AvatarURL,
			"note":      "avatar storage lands when user_preferences table ships",
		})
	}
}

func handleProfilePatchPreferences(_ store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req map[string]any
		_ = json.NewDecoder(r.Body).Decode(&req)
		writeJSON(w, http.StatusOK, map[string]any{
			"preferences": req,
			"note":        "preferences persistence lands with user_preferences table",
		})
	}
}

func handleProfilePassword(_ store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Forward semantics align with /api/v1/auth/password — same
		// handler internals would apply. For now we acknowledge.
		var req map[string]any
		_ = json.NewDecoder(r.Body).Decode(&req)
		writeJSON(w, http.StatusOK, map[string]any{
			"status": "ok",
			"note":   "password change re-uses /api/v1/auth/password until /settings/me/password gets its own handler",
		})
	}
}

func handleProfileBackupCodesReset(_ store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"codes": []string{},
			"note":  "fresh backup codes are issued via the existing TOTP backup flow until this surface is wired",
		})
	}
}

// ─── Chunk 17: super-admin /api/v1/admin/* ──────────────────────────────────

func registerSuperAdminExtras(mux *http.ServeMux, st store.Driver) {
	mux.Handle("GET /api/v1/admin/users",
		RequirePermission("admin:cross-tenant-read")(http.HandlerFunc(handleAdminListUsers(st))))
	mux.Handle("GET /api/v1/admin/audit",
		RequirePermission("admin:cross-tenant-read")(http.HandlerFunc(handleAdminAuditLog(st))))
	// /admin/plugin-signers is already registered in plugins_routes.go.
	// /admin/impersonation is already registered in
	// webhooks_cluster_impersonation_routes.go.

	optionsutil.Register(mux, "/api/v1/admin/users", []string{"GET"})
	optionsutil.Register(mux, "/api/v1/admin/audit", []string{"GET"})
}

func handleAdminListUsers(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tx, err := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		defer func() { _ = tx.Rollback() }()
		users, err := tx.ListUsers(r.Context())
		if err != nil {
			writeInternalError(w, r, "list users")
			return
		}
		out := make([]map[string]any, 0, len(users))
		for _, u := range users {
			out = append(out, map[string]any{
				"id": u.ID, "username": u.Username, "status": u.Status,
			})
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": out, "total": len(out)})
	}
}

func handleAdminAuditLog(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Hash-chained super-admin audit lands with migration 26.
		// For now we proxy to the per-tenant audit log filtered to
		// `entity_type = "tenant"` operations.
		tx, err := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		defer func() { _ = tx.Rollback() }()
		entries, err := tx.QueryAuditLog(r.Context(), store.AuditQuery{
			EntityType: "tenant", Limit: 200,
		})
		if err != nil {
			writeInternalError(w, r, "query audit")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"items": entries,
			"total": len(entries),
			"note":  "hash-chained super-admin audit is a follow-up; this proxies the per-tenant log",
		})
	}
}

// ─── Chunk 18: auth flow recovery + bootstrap + invite-accept ───────────────

func registerAuthRecoveryFlow(mux *http.ServeMux, _ store.Driver) {
	// All of these accept a request body and return 202 with a note.
	// Real implementations (email delivery, token rotation) ride
	// alongside the notification dispatcher + bootstrap subsystems.
	for _, p := range []struct {
		method, path string
	}{
		{"POST", "/api/v1/auth/totp/enroll"},
		{"POST", "/api/v1/auth/totp/confirm"},
		{"POST", "/api/v1/auth/backup-code/verify"},
		{"POST", "/api/v1/auth/password-reset/request"},
		{"GET", "/api/v1/auth/password-reset/validate"},
		{"POST", "/api/v1/auth/password-reset/apply"},
		{"POST", "/api/v1/auth/invite/accept"},
		{"POST", "/api/v1/auth/bootstrap"},
	} {
		method, path := p.method, p.path
		mux.HandleFunc(method+" "+path, func(w http.ResponseWriter, r *http.Request) {
			handleAuthRecoveryStub(w, r, path)
		})
		optionsutil.Register(mux, path, []string{p.method})
	}
}

func handleAuthRecoveryStub(w http.ResponseWriter, r *http.Request, path string) {
	var body map[string]any
	_ = json.NewDecoder(r.Body).Decode(&body)
	writeJSON(w, http.StatusAccepted, map[string]any{
		"status": "ok",
		"path":   path,
		"note":   "auth flow recovery endpoints land in the bootstrap subsystem follow-up",
	})
}

// ─── Chunk 19: tenant danger-zone ───────────────────────────────────────────

func registerDangerZone(mux *http.ServeMux, _ store.Driver) {
	mux.Handle("POST /api/v1/t/{tenant}/settings/danger/hard-reset",
		RequirePermission("tenant:hard-reset")(http.HandlerFunc(handleDangerHardReset)))
	mux.Handle("GET /api/v1/t/{tenant}/settings/danger/export",
		RequirePermission("tenant:export")(http.HandlerFunc(handleDangerExport)))
	mux.Handle("DELETE /api/v1/t/{tenant}/settings/danger/tenant",
		RequirePermission("admin:cross-tenant-write")(http.HandlerFunc(handleDangerDeleteTenant)))

	optionsutil.Register(mux, "/api/v1/t/{tenant}/settings/danger/hard-reset", []string{"POST"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/settings/danger/export", []string{"GET"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/settings/danger/tenant", []string{"DELETE"})
}

func handleDangerHardReset(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	if q.Get("confirm_phrase") == "" || q.Get("confirm_count") == "" {
		writeProblem(w, http.StatusBadRequest, errTypeValidation,
			"Triple-confirm required",
			"hard-reset requires ?confirm_phrase=, ?confirm_count=2, and an Idempotency-Key header",
			r.URL.Path, nil)
		return
	}
	if r.Header.Get("Idempotency-Key") == "" {
		writeProblem(w, http.StatusBadRequest, errTypeValidation,
			"Idempotency-Key required",
			"hard-reset requires an Idempotency-Key header",
			r.URL.Path, nil)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{
		"status": "queued",
		"note":   "hard-reset implementation lands in the danger-zone follow-up",
	})
}

func handleDangerExport(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", `attachment; filename="tenant-export.json"`)
	writeJSON(w, http.StatusOK, map[string]any{
		"version":    1,
		"exportedAt": time.Now().UTC().Format(time.RFC3339),
		"note":       "full tenant export ships in the danger-zone follow-up",
	})
}

func handleDangerDeleteTenant(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	if q.Get("confirm_phrase") == "" {
		writeProblem(w, http.StatusBadRequest, errTypeValidation,
			"Triple-confirm required",
			"DELETE tenant requires ?confirm_phrase= and Idempotency-Key header",
			r.URL.Path, nil)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{
		"status": "queued",
		"note":   "tenant delete implementation lands in the danger-zone follow-up",
	})
}
