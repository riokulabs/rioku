package store

import (
	"context"
	"errors"
	"reflect"
	"testing"
)

// fakeStore is a tiny in-memory roles repository for unit-testing
// computeEffectivePermissions in isolation from any DB driver.
type fakeStore map[string]*Role

func (f fakeStore) get(_ context.Context, id string) (*Role, error) {
	r, ok := f[id]
	if !ok {
		return nil, ErrRoleNotFound
	}
	return r, nil
}

func ptr(s string) *string { return &s }

func TestEffectivePermissions_NoParent(t *testing.T) {
	roles := fakeStore{
		"editor": {ID: "editor", Permissions: []string{"routes:write", "routes:read"}},
	}
	got, err := computeEffectivePermissions(context.Background(), roles.get, "editor")
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	want := []string{"routes:read", "routes:write"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestEffectivePermissions_WithParent(t *testing.T) {
	roles := fakeStore{
		"viewer": {ID: "viewer", Permissions: []string{"routes:read"}},
		"editor": {
			ID:           "editor",
			Permissions:  []string{"routes:write"},
			ParentRoleID: ptr("viewer"),
		},
	}
	got, err := computeEffectivePermissions(context.Background(), roles.get, "editor")
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	want := []string{"routes:read", "routes:write"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestEffectivePermissions_Transitive(t *testing.T) {
	roles := fakeStore{
		"base": {ID: "base", Permissions: []string{"a"}},
		"mid": {
			ID:           "mid",
			Permissions:  []string{"b"},
			ParentRoleID: ptr("base"),
		},
		"top": {
			ID:           "top",
			Permissions:  []string{"c"},
			ParentRoleID: ptr("mid"),
		},
	}
	got, err := computeEffectivePermissions(context.Background(), roles.get, "top")
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	want := []string{"a", "b", "c"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestEffectivePermissions_Deduplicates(t *testing.T) {
	roles := fakeStore{
		"viewer": {ID: "viewer", Permissions: []string{"a", "b"}},
		"editor": {
			ID:           "editor",
			Permissions:  []string{"b", "c"}, // overlaps with viewer's "b"
			ParentRoleID: ptr("viewer"),
		},
	}
	got, err := computeEffectivePermissions(context.Background(), roles.get, "editor")
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	want := []string{"a", "b", "c"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestEffectivePermissions_DirectCycle(t *testing.T) {
	// Self-loop: a -> a
	roles := fakeStore{
		"a": {ID: "a", Permissions: []string{"x"}, ParentRoleID: ptr("a")},
	}
	_, err := computeEffectivePermissions(context.Background(), roles.get, "a")
	if !errors.Is(err, ErrRoleCycle) {
		t.Fatalf("err = %v, want wrap ErrRoleCycle", err)
	}
}

func TestEffectivePermissions_IndirectCycle(t *testing.T) {
	// a -> b -> c -> a
	roles := fakeStore{
		"a": {ID: "a", Permissions: []string{"x"}, ParentRoleID: ptr("b")},
		"b": {ID: "b", Permissions: []string{"y"}, ParentRoleID: ptr("c")},
		"c": {ID: "c", Permissions: []string{"z"}, ParentRoleID: ptr("a")},
	}
	_, err := computeEffectivePermissions(context.Background(), roles.get, "a")
	if !errors.Is(err, ErrRoleCycle) {
		t.Fatalf("err = %v, want wrap ErrRoleCycle", err)
	}
}

func TestEffectivePermissions_DepthLimitExceeded(t *testing.T) {
	// Build a chain longer than RoleInheritanceMaxDepth, all
	// distinct (so the visited-set check doesn't fire) — verifies
	// the depth guard catches over-deep nesting.
	roles := fakeStore{}
	const overflow = RoleInheritanceMaxDepth + 5
	for i := 0; i < overflow; i++ {
		id := "r" + itoa(i)
		role := &Role{ID: id, Permissions: []string{"p" + itoa(i)}}
		if i > 0 {
			parent := "r" + itoa(i-1)
			role.ParentRoleID = &parent
		}
		roles[id] = role
	}
	_, err := computeEffectivePermissions(context.Background(), roles.get, "r"+itoa(overflow-1))
	if !errors.Is(err, ErrRoleDepthExceeded) {
		t.Fatalf("err = %v, want wrap ErrRoleDepthExceeded", err)
	}
}

func TestEffectivePermissions_MissingRolePropagates(t *testing.T) {
	roles := fakeStore{
		"editor": {
			ID:           "editor",
			Permissions:  []string{"x"},
			ParentRoleID: ptr("missing"),
		},
	}
	_, err := computeEffectivePermissions(context.Background(), roles.get, "editor")
	if !errors.Is(err, ErrRoleNotFound) {
		t.Fatalf("err = %v, want wrap ErrRoleNotFound", err)
	}
}

func TestValidateNoEscalation_ActorHoldsAllGranted(t *testing.T) {
	actor := []string{"routes:read", "routes:write", "services:read"}
	granted := []string{"routes:read", "services:read"}
	if err := ValidateNoEscalation(actor, granted); err != nil {
		t.Fatalf("err: %v", err)
	}
}

func TestValidateNoEscalation_RejectsExcess(t *testing.T) {
	actor := []string{"routes:read"}
	granted := []string{"routes:read", "routes:write"}
	err := ValidateNoEscalation(actor, granted)
	if !errors.Is(err, ErrRoleEscalation) {
		t.Fatalf("err = %v, want wrap ErrRoleEscalation", err)
	}
}

func TestValidateNoEscalation_WildcardCoversAction(t *testing.T) {
	actor := []string{"routes:*"}
	granted := []string{"routes:read", "routes:write", "routes:delete"}
	if err := ValidateNoEscalation(actor, granted); err != nil {
		t.Fatalf("err: %v", err)
	}
}

func TestValidateNoEscalation_WildcardDoesntCoverOtherResources(t *testing.T) {
	actor := []string{"routes:*"}
	granted := []string{"services:read"}
	err := ValidateNoEscalation(actor, granted)
	if !errors.Is(err, ErrRoleEscalation) {
		t.Fatalf("err = %v, want wrap ErrRoleEscalation", err)
	}
}

func TestValidateNoEscalation_GlobalWildcardCoversAll(t *testing.T) {
	actor := []string{"*"}
	granted := []string{"routes:read", "audits:write", "users:manage"}
	if err := ValidateNoEscalation(actor, granted); err != nil {
		t.Fatalf("err: %v", err)
	}
}

func TestValidateNoEscalation_EmptyGrantedAlwaysOk(t *testing.T) {
	if err := ValidateNoEscalation([]string{}, []string{}); err != nil {
		t.Fatal(err)
	}
}

// itoa keeps the test file dependency-free.
func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	const digits = "0123456789"
	var buf [10]byte
	pos := len(buf)
	for i > 0 {
		pos--
		buf[pos] = digits[i%10]
		i /= 10
	}
	return string(buf[pos:])
}
