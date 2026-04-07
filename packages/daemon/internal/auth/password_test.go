package auth_test

import (
	"strings"
	"testing"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/config"
)

func TestArgon2idHashVerify(t *testing.T) {
	t.Run("hash then verify matches", func(t *testing.T) {
		hash, err := auth.HashPassword("correcthorsebatterystaple")
		if err != nil {
			t.Fatalf("HashPassword() error = %v", err)
		}
		ok, err := auth.VerifyPassword("correcthorsebatterystaple", hash)
		if err != nil {
			t.Fatalf("VerifyPassword() error = %v", err)
		}
		if !ok {
			t.Error("VerifyPassword() returned false for correct password")
		}
	})

	t.Run("wrong password does not match", func(t *testing.T) {
		hash, err := auth.HashPassword("correcthorsebatterystaple")
		if err != nil {
			t.Fatalf("HashPassword() error = %v", err)
		}
		ok, err := auth.VerifyPassword("wrongpassword", hash)
		if err != nil {
			t.Fatalf("VerifyPassword() error = %v", err)
		}
		if ok {
			t.Error("VerifyPassword() returned true for wrong password")
		}
	})

	t.Run("same password produces different hashes", func(t *testing.T) {
		h1, err := auth.HashPassword("samepassword")
		if err != nil {
			t.Fatalf("HashPassword() first call error = %v", err)
		}
		h2, err := auth.HashPassword("samepassword")
		if err != nil {
			t.Fatalf("HashPassword() second call error = %v", err)
		}
		if h1 == h2 {
			t.Error("two hashes of the same password should differ (different salts)")
		}
		// Both should still verify.
		for i, h := range []string{h1, h2} {
			ok, err := auth.VerifyPassword("samepassword", h)
			if err != nil {
				t.Fatalf("VerifyPassword() hash[%d] error = %v", i, err)
			}
			if !ok {
				t.Errorf("VerifyPassword() hash[%d] returned false", i)
			}
		}
	})

	t.Run("hash format is valid argon2id", func(t *testing.T) {
		hash, err := auth.HashPassword("testpassword")
		if err != nil {
			t.Fatalf("HashPassword() error = %v", err)
		}
		// Expected format: $argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash>
		if !strings.HasPrefix(hash, "$argon2id$v=19$m=65536,t=3,p=4$") {
			t.Errorf("hash does not have expected argon2id prefix, got: %s", hash)
		}
		parts := strings.Split(hash, "$")
		// ["", "argon2id", "v=19", "m=65536,t=3,p=4", "<salt>", "<hash>"]
		if len(parts) != 6 {
			t.Errorf("expected 6 parts separated by $, got %d: %s", len(parts), hash)
		}
	})

	t.Run("verify rejects malformed hash", func(t *testing.T) {
		_, err := auth.VerifyPassword("pass", "notahash")
		if err == nil {
			t.Error("VerifyPassword() should return error for malformed hash")
		}
	})

	t.Run("verify rejects wrong algorithm", func(t *testing.T) {
		_, err := auth.VerifyPassword("pass", "$bcrypt$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA")
		if err == nil {
			t.Error("VerifyPassword() should return error for wrong algorithm")
		}
	})
}

func TestPasswordPolicyValidate(t *testing.T) {
	fullPolicy := config.PasswordPolicy{
		MinLength:        8,
		RequireUppercase: true,
		RequireLowercase: true,
		RequireDigit:     true,
		RequireSpecial:   true,
	}

	tests := []struct {
		name    string
		pass    string
		policy  config.PasswordPolicy
		wantErr bool
		errMsg  string // substring expected in error
	}{
		{
			name:    "empty password",
			pass:    "",
			policy:  fullPolicy,
			wantErr: true,
			errMsg:  "at least 8",
		},
		{
			name:    "too short",
			pass:    "Ab1!",
			policy:  fullPolicy,
			wantErr: true,
			errMsg:  "at least 8",
		},
		{
			name:    "missing uppercase",
			pass:    "abcdefg1!",
			policy:  fullPolicy,
			wantErr: true,
			errMsg:  "uppercase",
		},
		{
			name:    "missing lowercase",
			pass:    "ABCDEFG1!",
			policy:  fullPolicy,
			wantErr: true,
			errMsg:  "lowercase",
		},
		{
			name:    "missing digit",
			pass:    "Abcdefgh!",
			policy:  fullPolicy,
			wantErr: true,
			errMsg:  "digit",
		},
		{
			name:    "missing special",
			pass:    "Abcdefg1x",
			policy:  fullPolicy,
			wantErr: true,
			errMsg:  "special",
		},
		{
			name:    "valid password with all requirements",
			pass:    "Str0ng!Pass",
			policy:  fullPolicy,
			wantErr: false,
		},
		{
			name: "all requirements disabled short password passes",
			pass: "ab",
			policy: config.PasswordPolicy{
				MinLength: 1,
			},
			wantErr: false,
		},
		{
			name: "all requirements disabled but too short",
			pass: "",
			policy: config.PasswordPolicy{
				MinLength: 1,
			},
			wantErr: true,
			errMsg:  "at least 1",
		},
		{
			name: "zero min length allows empty",
			pass: "",
			policy: config.PasswordPolicy{
				MinLength: 0,
			},
			wantErr: false,
		},
		{
			name:    "multiple violations reported",
			pass:    "abc",
			policy:  fullPolicy,
			wantErr: true,
			errMsg:  "uppercase",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := auth.ValidatePasswordPolicy(tt.pass, tt.policy)
			if tt.wantErr && err == nil {
				t.Error("ValidatePasswordPolicy() expected error, got nil")
			}
			if !tt.wantErr && err != nil {
				t.Errorf("ValidatePasswordPolicy() unexpected error: %v", err)
			}
			if tt.wantErr && err != nil && tt.errMsg != "" {
				if !strings.Contains(err.Error(), tt.errMsg) {
					t.Errorf("error %q does not contain %q", err.Error(), tt.errMsg)
				}
			}
		})
	}
}
