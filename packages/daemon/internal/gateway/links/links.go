// Package links produces OpenAPI / HAL-style `_links` blobs for the
// daemon's REST surface.
//
// Every resource carries a `_links` map in its JSON envelope keyed by
// the relation name (`self`, `owner`, `tools`, `traces`, …). Each link
// is a {"href": "/api/v1/..."} object so callers can navigate the API
// without out-of-band knowledge of the URL layout.
//
// The Builder is the single place that knows the daemon's path
// conventions; DTO translators in `internal/gateway/dto/` consume it
// when assembling responses.
//
// Builder is safe for concurrent use — no shared mutable state.
package links

import (
	"fmt"
	"strings"
)

// Link is a single hypermedia reference. JSON shape is `{"href":
// "/api/v1/..."}` — kept minimal so a future move to full OpenAPI
// `Link` objects (with `templated`, `title`, etc.) is additive.
type Link struct {
	Href      string `json:"href"`
	Templated bool   `json:"templated,omitempty"`
}

// Set is an ordered map of relation name → Link. We model it as a
// map[string]Link in JSON; ordering is not preserved in JSON and is
// purely for builder ergonomics.
type Set map[string]Link

// Builder constructs links rooted at a tenant. Use NewTenantBuilder
// for tenant-scoped resources and NewRootBuilder for unscoped paths
// (auth flow, super-admin, health).
type Builder struct {
	prefix string // e.g. "/api/v1/t/acme" or "/api/v1"
}

// NewRootBuilder returns a Builder for paths under `/api/v1` with no
// tenant prefix. Used by `/api/v1/auth/...`, `/api/v1/admin/...`, and
// `/api/v1/health[…]`.
func NewRootBuilder() *Builder {
	return &Builder{prefix: "/api/v1"}
}

// NewTenantBuilder returns a Builder rooted at
// `/api/v1/t/{tenantSlug}`. The slug is taken from the resolved
// tenant's `Slug` field (NOT id — links must be human-meaningful and
// stable).
func NewTenantBuilder(tenantSlug string) *Builder {
	return &Builder{prefix: "/api/v1/t/" + tenantSlug}
}

// Self returns the canonical link to a resource item:
//
//	b.Self("api-keys", "key_abc")
//	  → /api/v1/t/{tenant}/api-keys/key_abc
func (b *Builder) Self(plural, id string) Link {
	return Link{Href: b.prefix + "/" + plural + "/" + id}
}

// Collection returns the link to a resource collection:
//
//	b.Collection("api-keys")
//	  → /api/v1/t/{tenant}/api-keys
func (b *Builder) Collection(plural string) Link {
	return Link{Href: b.prefix + "/" + plural}
}

// Sub returns the link to a sub-collection of a parent item:
//
//	b.Sub("ai/agents", "agent_x", "tools")
//	  → /api/v1/t/{tenant}/ai/agents/agent_x/tools
func (b *Builder) Sub(parentPlural, parentID, sub string) Link {
	return Link{Href: b.prefix + "/" + parentPlural + "/" + parentID + "/" + sub}
}

// SubItem returns the link to a sub-item:
//
//	b.SubItem("dashboards", "d_1", "widgets", "w_2")
//	  → /api/v1/t/{tenant}/dashboards/d_1/widgets/w_2
func (b *Builder) SubItem(parentPlural, parentID, sub, subID string) Link {
	return Link{Href: b.prefix + "/" + parentPlural + "/" + parentID + "/" + sub + "/" + subID}
}

// Action returns the link to a per-resource action:
//
//	b.Action("api-keys", "key_abc", "rotate")
//	  → /api/v1/t/{tenant}/api-keys/key_abc/rotate
func (b *Builder) Action(plural, id, action string) Link {
	return Link{Href: b.prefix + "/" + plural + "/" + id + "/" + action}
}

// CollectionAction returns the link to a collection-level action:
//
//	b.CollectionAction("notifications", "mark-all-read")
//	  → /api/v1/t/{tenant}/notifications/mark-all-read
func (b *Builder) CollectionAction(plural, action string) Link {
	return Link{Href: b.prefix + "/" + plural + "/" + action}
}

// Tenant returns the link to the active tenant root.
func (b *Builder) Tenant() Link {
	return Link{Href: b.prefix}
}

// PageNext returns a templated next-page link. Caller substitutes the
// continuation token in the path-template.
func (b *Builder) PageNext(plural, token string) Link {
	if token == "" {
		return Link{}
	}
	return Link{Href: fmt.Sprintf("%s/%s?page_token=%s", b.prefix, plural, token)}
}

// Prefix returns the underlying prefix. Exported for tests / ad-hoc
// callers that need to assemble unusual paths the typed helpers
// don't cover (e.g. `/auth/totp/setup`).
func (b *Builder) Prefix() string {
	return b.prefix
}

// Path returns a link to an arbitrary path under the builder's prefix.
// Useful for auth-flow / super-admin paths where the standard
// resource-shaped helpers don't apply.
func (b *Builder) Path(path string) Link {
	if path == "" {
		return Link{Href: b.prefix}
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	return Link{Href: b.prefix + path}
}
