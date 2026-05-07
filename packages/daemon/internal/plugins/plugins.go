// Package plugins provides static plugin data (marketplace catalog,
// manifest schema) and a manifest validator used by the gateway handlers.
package plugins

import (
	_ "embed"
	"encoding/json"
	"fmt"
)

//go:embed marketplace.json
var marketplaceJSON []byte

// MarketplaceEntry is a single curated plugin in the marketplace catalog.
type MarketplaceEntry struct {
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	Description      string   `json:"description"`
	Version          string   `json:"version"`
	SignerFingerprint string   `json:"signer_fingerprint"`
	ManifestURL      string   `json:"manifest_url"`
	Author           string   `json:"author"`
	Tags             []string `json:"tags"`
	Verified         bool     `json:"verified"`
}

// marketplaceCatalog is the parsed static catalog. Parsed once at init.
type marketplaceCatalog struct {
	Items []MarketplaceEntry `json:"items"`
}

var catalog marketplaceCatalog

func init() {
	if err := json.Unmarshal(marketplaceJSON, &catalog); err != nil {
		panic(fmt.Sprintf("plugins: failed to parse embedded marketplace.json: %v", err))
	}
}

// MarketplaceItems returns a copy of the curated marketplace listing.
func MarketplaceItems() []MarketplaceEntry {
	out := make([]MarketplaceEntry, len(catalog.Items))
	copy(out, catalog.Items)
	return out
}

// MarketplaceItem returns the entry with the given id, or false if not found.
func MarketplaceItem(id string) (MarketplaceEntry, bool) {
	for _, e := range catalog.Items {
		if e.ID == id {
			return e, true
		}
	}
	return MarketplaceEntry{}, false
}

// ─── Manifest validator ──────────────────────────────────────────────────────

// ManifestValidationError represents a single validation failure.
type ManifestValidationError struct {
	Path    string `json:"path"`
	Message string `json:"message"`
}

// ValidateManifest validates a plugin manifest map against the required schema.
// Required fields: id (string), name (string), version (string),
// permissions ([]string), capabilities ([]string).
// Returns (valid, errors).
func ValidateManifest(raw map[string]json.RawMessage) (bool, []ManifestValidationError) {
	var errs []ManifestValidationError

	required := []string{"id", "name", "version"}
	for _, field := range required {
		v, ok := raw[field]
		if !ok || string(v) == "null" {
			errs = append(errs, ManifestValidationError{
				Path:    field,
				Message: fmt.Sprintf("required field %q is missing", field),
			})
			continue
		}
		var s string
		if err := json.Unmarshal(v, &s); err != nil || s == "" {
			errs = append(errs, ManifestValidationError{
				Path:    field,
				Message: fmt.Sprintf("field %q must be a non-empty string", field),
			})
		}
	}

	// permissions — required, must be []string
	if v, ok := raw["permissions"]; !ok || string(v) == "null" {
		errs = append(errs, ManifestValidationError{
			Path:    "permissions",
			Message: `required field "permissions" is missing`,
		})
	} else {
		var perms []string
		if err := json.Unmarshal(v, &perms); err != nil {
			errs = append(errs, ManifestValidationError{
				Path:    "permissions",
				Message: `field "permissions" must be an array of strings`,
			})
		} else {
			for i, p := range perms {
				if p == "" {
					errs = append(errs, ManifestValidationError{
						Path:    fmt.Sprintf("permissions[%d]", i),
						Message: "permission key must be non-empty",
					})
				}
			}
		}
	}

	// signer_fingerprint — optional but if present must be non-empty string
	if v, ok := raw["signer_fingerprint"]; ok && string(v) != "null" {
		var s string
		if err := json.Unmarshal(v, &s); err != nil || s == "" {
			errs = append(errs, ManifestValidationError{
				Path:    "signer_fingerprint",
				Message: `field "signer_fingerprint" must be a non-empty string when present`,
			})
		}
	}

	// capabilities — optional array of strings
	if v, ok := raw["capabilities"]; ok && string(v) != "null" {
		var caps []string
		if err := json.Unmarshal(v, &caps); err != nil {
			errs = append(errs, ManifestValidationError{
				Path:    "capabilities",
				Message: `field "capabilities" must be an array of strings`,
			})
		}
	}

	// hooks — optional array of strings
	if v, ok := raw["hooks"]; ok && string(v) != "null" {
		var hooks []string
		if err := json.Unmarshal(v, &hooks); err != nil {
			errs = append(errs, ManifestValidationError{
				Path:    "hooks",
				Message: `field "hooks" must be an array of strings`,
			})
		}
	}

	// Unknown top-level keys are flagged as warnings embedded in errors
	knownKeys := map[string]bool{
		"id": true, "name": true, "version": true,
		"permissions": true, "signer_fingerprint": true,
		"capabilities": true, "hooks": true,
		"description": true, "author": true, "tags": true,
	}
	for k := range raw {
		if !knownKeys[k] {
			errs = append(errs, ManifestValidationError{
				Path:    k,
				Message: fmt.Sprintf("unknown field %q", k),
			})
		}
	}

	return len(errs) == 0, errs
}
