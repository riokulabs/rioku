package vault

import (
	"context"
	"errors"
	"testing"
)

func TestEnvBackend_Resolve(t *testing.T) {
	b := NewEnvBackend()
	if b.Name() != "env" {
		t.Fatalf("Name() = %q, want %q", b.Name(), "env")
	}
	if !b.Sync() {
		t.Fatal("Sync() = false, want true")
	}

	t.Run("present_value", func(t *testing.T) {
		t.Setenv("VAULT_TEST_PRESENT", "secret-value")
		got, err := b.Resolve(context.Background(), "VAULT_TEST_PRESENT")
		if err != nil {
			t.Fatalf("Resolve: %v", err)
		}
		if got != "secret-value" {
			t.Fatalf("got %q, want %q", got, "secret-value")
		}
	})

	t.Run("empty_value_is_present", func(t *testing.T) {
		t.Setenv("VAULT_TEST_EMPTY", "")
		got, err := b.Resolve(context.Background(), "VAULT_TEST_EMPTY")
		if err != nil {
			t.Fatalf("Resolve on empty: %v", err)
		}
		if got != "" {
			t.Fatalf("got %q, want empty", got)
		}
	})

	t.Run("absent_is_resolve_failed", func(t *testing.T) {
		_, err := b.Resolve(context.Background(), "VAULT_TEST_ABSENT_DEF_NOT_SET_xyz123")
		if !errors.Is(err, ErrResolveFailed) {
			t.Fatalf("err = %v, want wrap ErrResolveFailed", err)
		}
	})
}
