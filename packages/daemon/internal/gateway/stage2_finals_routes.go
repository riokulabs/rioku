// Package gateway: plugins install SSE, profile (`/settings/me`) family,
// super-admin surface, auth flow recovery, danger-zone.
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
	"github.com/riokulabs/rioku/internal/config"
	"github.com/riokulabs/rioku/internal/gateway/optionsutil"
	"github.com/riokulabs/rioku/internal/plugins"
	"github.com/riokulabs/rioku/internal/rerr"
	"github.com/riokulabs/rioku/internal/store"
)

// daemonCapabilities snapshots feature-flag state for the
// `/api/v1/capabilities` discovery endpoint.
//
// The admin panel calls this once on boot to decide which routes /
// nav entries to show. New flags should be added in alphabetical
// order so the JSON output is stable across versions.
type daemonCapabilities struct {
	SideloadEnabled bool `json:"sideload_enabled"`
}

// currentCapabilities is the package-level capabilities snapshot used
// by `handleCapabilities`. It is populated by
// `RegisterStage2FinalsRoutes` (via `SetCapabilities`) and read by the
// HTTP handler. A nil snapshot means all flags default to false.
//
// Tests may override this directly via SetCapabilities(...).
var currentCapabilities = &daemonCapabilities{}

// SetCapabilities updates the discovery snapshot returned by the
// `/api/v1/capabilities` endpoint. Callers should invoke this once at
// server boot with the resolved daemon Config; tests may invoke it
// repeatedly to flip flags between assertions.
func SetCapabilities(cfg *config.Config) {
	currentCapabilities = &daemonCapabilities{
		SideloadEnabled: cfg.SideloadEnabled(),
	}
}

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
	registerCapabilities(mux)
}

// registerCapabilities wires `GET /api/v1/capabilities` — a cheap
// auth-free feature-flag snapshot the admin panel calls once on boot
// to decide which nav entries / routes to show. The handler reads the
// package-level `currentCapabilities` snapshot, which is initialised
// by `SetCapabilities` at gateway boot.
func registerCapabilities(mux *http.ServeMux) {
	mux.Handle("GET /api/v1/capabilities", rerr.H(handleCapabilities))
	optionsutil.Register(mux, "/api/v1/capabilities", []string{"GET"})
}

func handleCapabilities(w http.ResponseWriter, _ *http.Request) error {
	caps := currentCapabilities
	if caps == nil {
		caps = &daemonCapabilities{}
	}
	return rerr.JSON(w, caps)
}

// ─── Plugins install SSE + marketplace alias + build-log + audit ─────────

func registerPluginsExtras(mux *http.ServeMux, st store.Driver) {
	// Existing in plugins_routes.go: POST /plugins/install, GET
	// /plugin-marketplace, GET /plugin-marketplace/{id}. We add:
	// - install-from-marketplace POST stub
	// - /plugins/marketplace alias (per spec) → reuse same handler
	// - plugin-signers/{id}/plugins sub-collection
	mux.Handle("POST /api/v1/t/{tenant}/plugins/install-from-marketplace",
		RequirePermission("plugins:write")(rerr.H(handlePluginInstallMarketplace(st))))
	// Sideload — accept multipart upload of a built plugin archive +
	// manifest. Stub: returns 501 with a documented decisions list so
	// the admin form can wire end-to-end and exercise the permission
	// guard. Real install pipeline ships with #142/#143/#146.
	mux.Handle("POST /api/v1/t/{tenant}/plugins/sideload",
		RequirePermission("plugin:install")(rerr.H(handlePluginSideload(st))))
	// /plugin-signers/{id}/plugins is already registered in
	// plugins_routes.go.

	optionsutil.Register(mux, "/api/v1/t/{tenant}/plugins/install-from-marketplace", []string{"POST"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/plugins/sideload", []string{"POST"})
}

func handlePluginInstallMarketplace(_ store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		var req map[string]any
		_ = json.NewDecoder(r.Body).Decode(&req)
		w.WriteHeader(http.StatusAccepted)
		return rerr.JSON(w, map[string]any{
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
//     ladder); the current implementation records the signer
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
func handlePluginSideload(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		// Dev-mode-only gate: when sideload is disabled (the default
		// in production), return 404 (NOT 403) so the endpoint
		// effectively does not exist. Admin panel reads
		// `/api/v1/capabilities.sideload_enabled` to decide whether
		// to render the sideload route at all. Returning 404 instead
		// of 403 prevents endpoint-existence leakage.
		if currentCapabilities == nil || !currentCapabilities.SideloadEnabled {
			http.NotFound(w, r)
			return nil
		}

		ctx := r.Context()
		scope, ok := scopeForRequest(r, false)
		if !ok || scope == "" {
			return rerr.Validation(map[string]string{"tenant": "sideload requires a tenant-scoped path"})
		}

		if err := r.ParseMultipartForm(32 << 20); err != nil {
			return rerr.Validation(map[string]string{"body": "expected multipart/form-data with 'archive' and 'manifest' parts"})
		}

		archiveBytes, archiveName, err := readMultipartFile(r, "archive")
		if err != nil {
			return rerr.Validation(map[string]string{"archive": "missing or unreadable 'archive' part: " + err.Error()})
		}
		manifestBytes, _, err := readMultipartFile(r, "manifest")
		if err != nil {
			return rerr.Validation(map[string]string{"manifest": "missing or unreadable 'manifest' part: " + err.Error()})
		}

		// Validate manifest shape using the shared validator.
		var raw map[string]json.RawMessage
		if err := json.Unmarshal(manifestBytes, &raw); err != nil {
			return rerr.Validation(map[string]string{"manifest": "manifest is not valid JSON: " + err.Error()})
		}
		valid, validationErrs := plugins.ValidateManifest(raw)
		if !valid {
			fields := make(map[string]string, len(validationErrs))
			for _, e := range validationErrs {
				fields[e.Path] = e.Message
			}
			return rerr.Validation(fields)
		}

		// Pull a few canonical fields out of the manifest. The validator
		// already guaranteed they exist + are non-empty strings.
		var manifest struct {
			ID          string   `json:"id"`
			Name        string   `json:"name"`
			Version     string   `json:"version"`
			Arch        string   `json:"arch,omitempty"`
			Permissions []string `json:"permissions"`
		}
		if err := json.Unmarshal(manifestBytes, &manifest); err != nil {
			return rerr.Validation(map[string]string{"manifest": "manifest decode: " + err.Error()})
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
				return rerr.Forbidden("Signer-Fingerprint header set but no 'signature' part provided")
			}
			signer, perr := lookupTenantSignerByFingerprint(ctx, st, scope, signerFP)
			if perr != nil {
				return rerr.Forbidden(perr.Error())
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
			return rerr.Wrap(fmt.Errorf("plugin staging directory is not configured"), "config")
		}
		// Reserve a UUID-ish id for the staging path. We let the store
		// generate the canonical row id; we use a transient subdir
		// that we rename on commit.
		parent := filepath.Join(stagingBase, "plugins")
		if err := os.MkdirAll(parent, 0o750); err != nil {
			return rerr.Wrap(err, "create staging parent")
		}
		tmpDir, err := os.MkdirTemp(parent, "stage-*")
		if err != nil {
			return rerr.Wrap(err, "create staging dir")
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
			return rerr.Wrap(err, "write manifest")
		}
		if err := os.WriteFile(filepath.Join(tmpDir, archiveBase), archiveBytes, 0o640); err != nil {
			return rerr.Wrap(err, "write archive")
		}
		if len(signatureBytes) > 0 {
			if err := os.WriteFile(filepath.Join(tmpDir, "signature.bin"), signatureBytes, 0o640); err != nil {
				return rerr.Wrap(err, "write signature")
			}
		}

		// Insert the DB row.
		ts := scope
		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
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
				return rerr.Conflict("A plugin with id "+manifest.ID+" already exists in this tenant", err)
			}
			return rerr.Wrap(err, "create plugin")
		}

		// Register manifest-declared permissions in the catalog so role
		// grants can target them. Same Tx as CreatePlugin so a perm
		// registration failure rolls back the plugin row too.
		if len(manifest.Permissions) > 0 {
			rows, perr := plugins.BuildPermissionRows(manifest.Permissions)
			if perr != nil {
				_ = tx.Rollback()
				return rerr.Validation(map[string]string{"permissions": "manifest permissions: " + perr.Error()})
			}
			if err := tx.RegisterPluginPermissions(ctx, created.ID, rows); err != nil {
				_ = tx.Rollback()
				if errors.Is(err, store.ErrPermissionConflict) {
					return rerr.Conflict("One or more manifest permissions clash with existing catalog entries", err)
				}
				return rerr.Wrap(err, "register plugin permissions")
			}
		}

		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit plugin")
		}

		// Promote the staging directory to its canonical id-keyed path.
		finalDir := filepath.Join(stagingBase, "plugins", scope, created.ID)
		if err := os.MkdirAll(filepath.Dir(finalDir), 0o750); err != nil {
			return rerr.Wrap(err, "create plugin dir")
		}
		if err := os.Rename(tmpDir, finalDir); err != nil {
			return rerr.Wrap(err, "promote staging dir")
		}
		stagedOK = true

		w.WriteHeader(http.StatusCreated)
		return rerr.JSON(w, map[string]any{
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

// ─── /settings/me profile family ────────────────────────────────────────────

func registerProfileFamily(mux *http.ServeMux, st store.Driver) {
	get := RequirePermission("self:read")(rerr.H(handleProfileGet(st)))
	patchName := RequirePermission("self:write")(rerr.H(handleProfilePatchName(st)))
	patchAvatar := RequirePermission("self:write")(rerr.H(handleProfilePatchAvatar(st)))
	patchPrefs := RequirePermission("self:write")(rerr.H(handleProfilePatchPreferences(st)))
	patchAll := RequirePermission("self:write")(rerr.H(handleProfilePatch(st)))
	postPassword := RequirePermission("self:write")(rerr.H(handleProfilePassword(st)))
	postBackupCodes := RequirePermission("self:write")(rerr.H(handleProfileBackupCodesReset(st)))

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

func handleProfileGet(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		ctx := r.Context()
		sc := auth.SessionClaimsFromContext(ctx)
		if sc == nil {
			return rerr.Unauthenticated()
		}
		tx, err := st.Begin(ctx, store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		user, err := tx.GetUser(ctx, sc.UserID)
		if err != nil {
			return rerr.Wrap(err, "get user")
		}
		return rerr.JSON(w, map[string]any{
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

func handleProfilePatch(_ store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		// Combined patch — accept all fields and forward to the
		// per-field PATCH handlers via storage methods directly.
		return rerr.JSON(w, map[string]any{
			"status": "ok",
			"note":   "combined PATCH accepted; per-field PATCH endpoints carry the canonical write-paths",
		})
	}
}

func handleProfilePatchName(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		ctx := r.Context()
		sc := auth.SessionClaimsFromContext(ctx)
		if sc == nil {
			return rerr.Unauthenticated()
		}
		var req struct {
			DisplayName string `json:"displayName"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}
		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		user, err := tx.GetUser(ctx, sc.UserID)
		if err != nil {
			_ = tx.Rollback()
			return rerr.Wrap(err, "get user")
		}
		user.DisplayName = &req.DisplayName
		if _, err := tx.UpdateUser(ctx, user); err != nil {
			_ = tx.Rollback()
			return rerr.Wrap(err, "update user")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		return rerr.JSON(w, map[string]any{"displayName": req.DisplayName})
	}
}

func handleProfilePatchAvatar(_ store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		var req struct {
			AvatarURL string `json:"avatarUrl"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		// Avatar storage isn't wired into store.User yet; placeholder.
		return rerr.JSON(w, map[string]any{
			"avatarUrl": req.AvatarURL,
			"note":      "avatar storage lands when user_preferences table ships",
		})
	}
}

func handleProfilePatchPreferences(_ store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		var req map[string]any
		_ = json.NewDecoder(r.Body).Decode(&req)
		return rerr.JSON(w, map[string]any{
			"preferences": req,
			"note":        "preferences persistence lands with user_preferences table",
		})
	}
}

func handleProfilePassword(_ store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		// Forward semantics align with /api/v1/auth/password — same
		// handler internals would apply. For now we acknowledge.
		var req map[string]any
		_ = json.NewDecoder(r.Body).Decode(&req)
		return rerr.JSON(w, map[string]any{
			"status": "ok",
			"note":   "password change re-uses /api/v1/auth/password until /settings/me/password gets its own handler",
		})
	}
}

func handleProfileBackupCodesReset(_ store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		return rerr.JSON(w, map[string]any{
			"codes": []string{},
			"note":  "fresh backup codes are issued via the existing TOTP backup flow until this surface is wired",
		})
	}
}

// ─── super-admin /api/v1/admin/* ────────────────────────────────────────────

func registerSuperAdminExtras(mux *http.ServeMux, st store.Driver) {
	mux.Handle("GET /api/v1/admin/users",
		RequirePermission("admin:cross-tenant-read")(rerr.H(handleAdminListUsers(st))))
	mux.Handle("GET /api/v1/admin/audit",
		RequirePermission("admin:cross-tenant-read")(rerr.H(handleAdminAuditLog(st))))
	// /admin/plugin-signers is already registered in plugins_routes.go.
	// /admin/impersonation is already registered in
	// webhooks_cluster_impersonation_routes.go.

	optionsutil.Register(mux, "/api/v1/admin/users", []string{"GET"})
	optionsutil.Register(mux, "/api/v1/admin/audit", []string{"GET"})
}

func handleAdminListUsers(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tx, err := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		users, err := tx.ListUsers(r.Context())
		if err != nil {
			return rerr.Wrap(err, "list users")
		}
		out := make([]map[string]any, 0, len(users))
		for _, u := range users {
			out = append(out, map[string]any{
				"id": u.ID, "username": u.Username, "status": u.Status,
			})
		}
		return rerr.JSON(w, map[string]any{"items": out, "total": len(out)})
	}
}

func handleAdminAuditLog(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		// Hash-chained super-admin audit lands with migration 26.
		// For now we proxy to the per-tenant audit log filtered to
		// `entity_type = "tenant"` operations.
		tx, err := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		entries, err := tx.QueryAuditLog(r.Context(), store.AuditQuery{
			EntityType: "tenant", Limit: 200,
		})
		if err != nil {
			return rerr.Wrap(err, "query audit")
		}
		return rerr.JSON(w, map[string]any{
			"items": entries,
			"total": len(entries),
			"note":  "hash-chained super-admin audit is a follow-up; this proxies the per-tenant log",
		})
	}
}

// ─── auth flow recovery + invite-accept ─────────────────────────────────────
// Note: POST /auth/bootstrap and GET /auth/bootstrap-status are real
// implementations registered via RegisterBootstrapRoutes (plan 01).
// Password-reset and invite-accept are real implementations registered via
// RegisterPasswordResetRoutes and RegisterInviteRoutes (plan 01).
// The stubs below are kept for TOTP enroll/confirm which remain in-progress.

func registerAuthRecoveryFlow(mux *http.ServeMux, _ store.Driver) {
	// Stubs for endpoints not yet fully implemented.
	for _, p := range []struct {
		method, path string
	}{
		{"POST", "/api/v1/auth/totp/enroll"},
		{"POST", "/api/v1/auth/totp/confirm"},
		{"POST", "/api/v1/auth/backup-code/verify"},
	} {
		method, path := p.method, p.path
		mux.Handle(method+" "+path, rerr.H(func(w http.ResponseWriter, r *http.Request) error {
			return handleAuthRecoveryStub(w, r, path)
		}))
		optionsutil.Register(mux, path, []string{p.method})
	}
}

func handleAuthRecoveryStub(w http.ResponseWriter, r *http.Request, path string) error {
	var body map[string]any
	_ = json.NewDecoder(r.Body).Decode(&body)
	w.WriteHeader(http.StatusAccepted)
	return rerr.JSON(w, map[string]any{
		"status": "ok",
		"path":   path,
		"note":   "auth flow recovery endpoints land in the bootstrap subsystem follow-up",
	})
}

// ─── tenant danger-zone ─────────────────────────────────────────────────────

func registerDangerZone(mux *http.ServeMux, _ store.Driver) {
	mux.Handle("POST /api/v1/t/{tenant}/settings/danger/hard-reset",
		RequirePermission("tenant:hard-reset")(rerr.H(handleDangerHardReset)))
	mux.Handle("GET /api/v1/t/{tenant}/settings/danger/export",
		RequirePermission("tenant:export")(rerr.H(handleDangerExport)))
	mux.Handle("DELETE /api/v1/t/{tenant}/settings/danger/tenant",
		RequirePermission("admin:cross-tenant-write")(rerr.H(handleDangerDeleteTenant)))

	optionsutil.Register(mux, "/api/v1/t/{tenant}/settings/danger/hard-reset", []string{"POST"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/settings/danger/export", []string{"GET"})
	optionsutil.Register(mux, "/api/v1/t/{tenant}/settings/danger/tenant", []string{"DELETE"})
}

func handleDangerHardReset(w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query()
	if q.Get("confirm_phrase") == "" || q.Get("confirm_count") == "" {
		return rerr.Validation(map[string]string{"confirm_phrase": "hard-reset requires ?confirm_phrase=, ?confirm_count=2, and an Idempotency-Key header"})
	}
	if r.Header.Get("Idempotency-Key") == "" {
		return rerr.Validation(map[string]string{"Idempotency-Key": "hard-reset requires an Idempotency-Key header"})
	}
	w.WriteHeader(http.StatusAccepted)
	return rerr.JSON(w, map[string]any{
		"status": "queued",
		"note":   "hard-reset implementation lands in the danger-zone follow-up",
	})
}

func handleDangerExport(w http.ResponseWriter, r *http.Request) error {
	w.Header().Set("Content-Disposition", `attachment; filename="tenant-export.json"`)
	return rerr.JSON(w, map[string]any{
		"version":    1,
		"exportedAt": time.Now().UTC().Format(time.RFC3339),
		"note":       "full tenant export ships in the danger-zone follow-up",
	})
}

func handleDangerDeleteTenant(w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query()
	if q.Get("confirm_phrase") == "" {
		return rerr.Validation(map[string]string{"confirm_phrase": "DELETE tenant requires ?confirm_phrase= and Idempotency-Key header"})
	}
	w.WriteHeader(http.StatusAccepted)
	return rerr.JSON(w, map[string]any{
		"status": "queued",
		"note":   "tenant delete implementation lands in the danger-zone follow-up",
	})
}
