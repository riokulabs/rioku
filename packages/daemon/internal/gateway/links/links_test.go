package links

import (
	"encoding/json"
	"testing"
)

func TestTenantBuilder_Self(t *testing.T) {
	b := NewTenantBuilder("acme")
	got := b.Self("api-keys", "key_abc")
	want := "/api/v1/t/acme/api-keys/key_abc"
	if got.Href != want {
		t.Errorf("Self = %q, want %q", got.Href, want)
	}
}

func TestTenantBuilder_Collection(t *testing.T) {
	b := NewTenantBuilder("acme")
	if got := b.Collection("services"); got.Href != "/api/v1/t/acme/services" {
		t.Errorf("Collection = %q", got.Href)
	}
}

func TestTenantBuilder_SubItemActionCollectionAction(t *testing.T) {
	b := NewTenantBuilder("acme")

	if got := b.Sub("ai/agents", "agent_x", "tools"); got.Href != "/api/v1/t/acme/ai/agents/agent_x/tools" {
		t.Errorf("Sub = %q", got.Href)
	}
	if got := b.SubItem("dashboards", "d_1", "widgets", "w_2"); got.Href != "/api/v1/t/acme/dashboards/d_1/widgets/w_2" {
		t.Errorf("SubItem = %q", got.Href)
	}
	if got := b.Action("api-keys", "key_abc", "rotate"); got.Href != "/api/v1/t/acme/api-keys/key_abc/rotate" {
		t.Errorf("Action = %q", got.Href)
	}
	if got := b.CollectionAction("notifications", "mark-all-read"); got.Href != "/api/v1/t/acme/notifications/mark-all-read" {
		t.Errorf("CollectionAction = %q", got.Href)
	}
}

func TestRootBuilder_Path(t *testing.T) {
	b := NewRootBuilder()
	if got := b.Path("/auth/totp/setup"); got.Href != "/api/v1/auth/totp/setup" {
		t.Errorf("Path = %q", got.Href)
	}
	// Without leading slash works too.
	if got := b.Path("admin/users"); got.Href != "/api/v1/admin/users" {
		t.Errorf("Path (no slash) = %q", got.Href)
	}
}

func TestSet_JSONShape(t *testing.T) {
	s := Set{
		"self":  Link{Href: "/api/v1/t/acme/api-keys/key_abc"},
		"owner": Link{Href: "/api/v1/t/acme/users/u_42"},
	}
	raw, err := json.Marshal(s)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var back map[string]map[string]any
	if err := json.Unmarshal(raw, &back); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if back["self"]["href"] != "/api/v1/t/acme/api-keys/key_abc" {
		t.Errorf("self.href round-trip mismatch: %v", back["self"])
	}
	if _, has := back["self"]["templated"]; has {
		t.Error("templated should be omitted when false")
	}
}

func TestPageNext_EmptyTokenReturnsEmptyLink(t *testing.T) {
	b := NewTenantBuilder("acme")
	got := b.PageNext("audit", "")
	if got.Href != "" {
		t.Errorf("PageNext('') = %q, want empty", got.Href)
	}
}

func TestPageNext_WithToken(t *testing.T) {
	b := NewTenantBuilder("acme")
	got := b.PageNext("audit", "abc123")
	want := "/api/v1/t/acme/audit?page_token=abc123"
	if got.Href != want {
		t.Errorf("PageNext = %q, want %q", got.Href, want)
	}
}
