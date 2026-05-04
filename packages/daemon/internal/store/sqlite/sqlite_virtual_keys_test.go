package sqlite_test

import (
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/riokulabs/rioku/internal/store"
	_ "github.com/riokulabs/rioku/internal/store/sqlite"
)

func newVKParams(name string) store.CreateVirtualKeyParams {
	return store.CreateVirtualKeyParams{
		ID:            "vk_" + uuid.NewString(),
		TenantID:      "tenant_default",
		Name:          name,
		ProviderID:    "openai",
		CredentialRef: "vault://kv/openai/key",
		AllowedModels: []string{"gpt-4o", "gpt-4o-mini"},
		RPMLimit:      60,
		TPMLimit:      40000,
		BudgetUSD:     50,
		BudgetWindow:  store.BudgetWindowMonth,
	}
}

func TestVirtualKey_CreateAndGet(t *testing.T) {
	d, close := openTempStore(t)
	defer close()
	ctx := tenantCtx(t)
	tx, _ := d.Begin(ctx, store.TxOptions{})
	defer tx.Rollback() //nolint:errcheck

	p := newVKParams("primary-key")
	created, err := tx.CreateVirtualKey(ctx, p)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if created.ID != p.ID || created.Name != "primary-key" {
		t.Errorf("round-trip mismatch: %+v", created)
	}
	if !created.AllowsModel("gpt-4o") {
		t.Error("AllowsModel(gpt-4o) = false")
	}
	if created.AllowsModel("claude-3-5-sonnet-20241022") {
		t.Error("AllowsModel(claude) = true, want false (not in allow list)")
	}
	if !created.IsActive() {
		t.Error("IsActive() = false on fresh key")
	}

	got, err := tx.GetVirtualKey(ctx, p.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.BudgetWindow != store.BudgetWindowMonth || got.BudgetUSD != 50 {
		t.Errorf("budget round-trip lost: %+v", got)
	}
	if len(got.AllowedModels) != 2 {
		t.Errorf("AllowedModels len = %d, want 2", len(got.AllowedModels))
	}
}

func TestVirtualKey_GetMissingReturnsSentinel(t *testing.T) {
	d, close := openTempStore(t)
	defer close()
	ctx := tenantCtx(t)
	tx, _ := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	defer tx.Rollback() //nolint:errcheck

	_, err := tx.GetVirtualKey(ctx, "vk_nope")
	if !errors.Is(err, store.ErrVirtualKeyNotFound) {
		t.Fatalf("err = %v, want wrap ErrVirtualKeyNotFound", err)
	}
}

func TestVirtualKey_NameUniquenessPerTenant(t *testing.T) {
	d, close := openTempStore(t)
	defer close()
	ctx := tenantCtx(t)
	tx, _ := d.Begin(ctx, store.TxOptions{})
	defer tx.Rollback() //nolint:errcheck

	if _, err := tx.CreateVirtualKey(ctx, newVKParams("dup")); err != nil {
		t.Fatal(err)
	}
	_, err := tx.CreateVirtualKey(ctx, newVKParams("dup"))
	if !errors.Is(err, store.ErrVirtualKeyNameTaken) {
		t.Fatalf("err = %v, want wrap ErrVirtualKeyNameTaken", err)
	}
}

func TestVirtualKey_List(t *testing.T) {
	d, close := openTempStore(t)
	defer close()
	ctx := tenantCtx(t)
	tx, _ := d.Begin(ctx, store.TxOptions{})
	defer tx.Rollback() //nolint:errcheck

	for _, n := range []string{"alpha", "beta", "gamma"} {
		if _, err := tx.CreateVirtualKey(ctx, newVKParams(n)); err != nil {
			t.Fatal(err)
		}
	}
	keys, err := tx.ListVirtualKeys(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(keys) != 3 {
		t.Fatalf("len = %d, want 3", len(keys))
	}
	// Sorted by name.
	if keys[0].Name != "alpha" || keys[2].Name != "gamma" {
		t.Errorf("ordering wrong: %s, %s", keys[0].Name, keys[2].Name)
	}
}

func TestVirtualKey_UpdateAndRotate(t *testing.T) {
	d, close := openTempStore(t)
	defer close()
	ctx := tenantCtx(t)
	tx, _ := d.Begin(ctx, store.TxOptions{})
	defer tx.Rollback() //nolint:errcheck

	p := newVKParams("editable")
	if _, err := tx.CreateVirtualKey(ctx, p); err != nil {
		t.Fatal(err)
	}

	newName := "renamed"
	newRPM := int32(120)
	newAllow := []string{"gpt-4o"}
	updated, err := tx.UpdateVirtualKey(ctx, p.ID, store.UpdateVirtualKeyParams{
		Name:          &newName,
		RPMLimit:      &newRPM,
		AllowedModels: &newAllow,
	})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if updated.Name != "renamed" || updated.RPMLimit != 120 {
		t.Errorf("update lost: %+v", updated)
	}
	if len(updated.AllowedModels) != 1 || updated.AllowedModels[0] != "gpt-4o" {
		t.Errorf("AllowedModels = %v, want [gpt-4o]", updated.AllowedModels)
	}
	// Untouched fields preserved.
	if updated.ProviderID != "openai" {
		t.Errorf("ProviderID lost on partial update: %q", updated.ProviderID)
	}

	rotated, err := tx.RotateVirtualKey(ctx, p.ID, "vault://kv/openai/key-v2")
	if err != nil {
		t.Fatalf("Rotate: %v", err)
	}
	if rotated.CredentialRef != "vault://kv/openai/key-v2" {
		t.Errorf("CredentialRef = %q, want rotated value", rotated.CredentialRef)
	}
}

func TestVirtualKey_RevokeIdempotent(t *testing.T) {
	d, close := openTempStore(t)
	defer close()
	ctx := tenantCtx(t)
	tx, _ := d.Begin(ctx, store.TxOptions{})
	defer tx.Rollback() //nolint:errcheck

	p := newVKParams("revoke-me")
	if _, err := tx.CreateVirtualKey(ctx, p); err != nil {
		t.Fatal(err)
	}
	if err := tx.RevokeVirtualKey(ctx, p.ID); err != nil {
		t.Fatal(err)
	}
	got, _ := tx.GetVirtualKey(ctx, p.ID)
	if got.IsActive() {
		t.Error("IsActive() = true after Revoke")
	}
	if got.RevokedAt == nil {
		t.Error("RevokedAt = nil after Revoke")
	}
	// Re-revoke is a no-op (matches partial-rev semantics — the
	// SQL only fires when revoked_at IS NULL, and we expect
	// ErrVirtualKeyNotFound on the second call).
	err := tx.RevokeVirtualKey(ctx, p.ID)
	if !errors.Is(err, store.ErrVirtualKeyNotFound) {
		t.Errorf("second Revoke err = %v, want ErrVirtualKeyNotFound (already revoked)", err)
	}
}

func TestVirtualKey_Delete(t *testing.T) {
	d, close := openTempStore(t)
	defer close()
	ctx := tenantCtx(t)
	tx, _ := d.Begin(ctx, store.TxOptions{})
	defer tx.Rollback() //nolint:errcheck

	p := newVKParams("doomed")
	if _, err := tx.CreateVirtualKey(ctx, p); err != nil {
		t.Fatal(err)
	}
	if err := tx.DeleteVirtualKey(ctx, p.ID); err != nil {
		t.Fatal(err)
	}
	_, err := tx.GetVirtualKey(ctx, p.ID)
	if !errors.Is(err, store.ErrVirtualKeyNotFound) {
		t.Errorf("after delete: err = %v, want ErrVirtualKeyNotFound", err)
	}
	// Second delete returns sentinel too.
	err = tx.DeleteVirtualKey(ctx, p.ID)
	if !errors.Is(err, store.ErrVirtualKeyNotFound) {
		t.Errorf("idempotent delete: err = %v, want ErrVirtualKeyNotFound", err)
	}
}

func TestVirtualKey_TenantIsolation(t *testing.T) {
	d, close := openTempStore(t)
	defer close()
	ctx := tenantCtx(t)
	tx, _ := d.Begin(ctx, store.TxOptions{})

	p := newVKParams("scoped")
	if _, err := tx.CreateVirtualKey(ctx, p); err != nil {
		t.Fatal(err)
	}
	_ = tx.Commit()

	// A different tenant context should not see the key.
	other := store.WithTenantID(t.Context(), "tenant_other")
	tx2, _ := d.Begin(other, store.TxOptions{ReadOnly: true})
	defer tx2.Rollback() //nolint:errcheck
	_, err := tx2.GetVirtualKey(other, p.ID)
	if !errors.Is(err, store.ErrVirtualKeyNotFound) {
		t.Errorf("cross-tenant Get err = %v, want ErrVirtualKeyNotFound", err)
	}
	keys, _ := tx2.ListVirtualKeys(other)
	if len(keys) != 0 {
		t.Errorf("cross-tenant List len = %d, want 0", len(keys))
	}
}
