package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"unicode"

	"golang.org/x/crypto/argon2"

	"github.com/riokulabs/rioku/internal/config"
)

// Argon2id parameters. These are vars (not consts) so tests can reduce
// them via SetTestHashParams for fast test execution.
var (
	argonMemory      uint32 = 64 * 1024 // 64 MB
	argonIterations  uint32 = 3
	argonParallelism uint8  = 4
	argonSaltLen     uint32 = 16
	argonKeyLen      uint32 = 32
)

// SetTestHashParams reduces argon2id parameters for fast test execution.
// Call this in TestMain before running tests. Never call in production.
func SetTestHashParams() {
	argonMemory = 1024   // 1 MB (vs 64 MB)
	argonIterations = 1  // 1 iteration (vs 3)
	argonParallelism = 1 // 1 thread (vs 4)
}

// HashPassword hashes a plaintext password using argon2id and returns an
// encoded string in the PHC format:
//
//	$argon2id$v=19$m=65536,t=3,p=4$<base64-salt>$<base64-hash>
func HashPassword(password string) (string, error) {
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("auth: generate salt: %w", err)
	}

	hash := argon2.IDKey([]byte(password), salt, argonIterations, argonMemory, argonParallelism, argonKeyLen)

	encoded := fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version,
		argonMemory,
		argonIterations,
		argonParallelism,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(hash),
	)
	return encoded, nil
}

// VerifyPassword checks a plaintext password against an encoded argon2id hash.
// It returns (true, nil) on match, (false, nil) on mismatch, and (false, error)
// if the encoded hash cannot be parsed.
func VerifyPassword(password, encoded string) (bool, error) {
	parts := strings.Split(encoded, "$")
	// Expected: ["", "argon2id", "v=19", "m=65536,t=3,p=4", "<salt>", "<hash>"]
	if len(parts) != 6 {
		return false, fmt.Errorf("auth: invalid hash format: expected 6 $-delimited fields, got %d", len(parts))
	}
	if parts[1] != "argon2id" {
		return false, fmt.Errorf("auth: unsupported algorithm %q, expected argon2id", parts[1])
	}

	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil {
		return false, fmt.Errorf("auth: parse version: %w", err)
	}

	var memory uint32
	var iterations uint32
	var parallelism uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &iterations, &parallelism); err != nil {
		return false, fmt.Errorf("auth: parse parameters: %w", err)
	}

	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false, fmt.Errorf("auth: decode salt: %w", err)
	}

	storedHash, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return false, fmt.Errorf("auth: decode hash: %w", err)
	}

	derivedHash := argon2.IDKey([]byte(password), salt, iterations, memory, parallelism, uint32(len(storedHash)))

	if subtle.ConstantTimeCompare(derivedHash, storedHash) == 1 {
		return true, nil
	}
	return false, nil
}

// ValidatePasswordPolicy checks a password against the given policy and returns
// a descriptive error listing all violations. It returns nil if the password
// satisfies every enabled rule.
func ValidatePasswordPolicy(password string, policy config.PasswordPolicy) error {
	var violations []string

	if policy.MinLength > 0 && len(password) < policy.MinLength {
		violations = append(violations, fmt.Sprintf("must be at least %d characters", policy.MinLength))
	}

	if policy.RequireUppercase || policy.RequireLowercase || policy.RequireDigit || policy.RequireSpecial {
		var hasUpper, hasLower, hasDigit, hasSpecial bool
		for _, r := range password {
			switch {
			case unicode.IsUpper(r):
				hasUpper = true
			case unicode.IsLower(r):
				hasLower = true
			case unicode.IsDigit(r):
				hasDigit = true
			case !unicode.IsLetter(r) && !unicode.IsDigit(r):
				hasSpecial = true
			}
		}

		if policy.RequireUppercase && !hasUpper {
			violations = append(violations, "must contain at least one uppercase letter")
		}
		if policy.RequireLowercase && !hasLower {
			violations = append(violations, "must contain at least one lowercase letter")
		}
		if policy.RequireDigit && !hasDigit {
			violations = append(violations, "must contain at least one digit")
		}
		if policy.RequireSpecial && !hasSpecial {
			violations = append(violations, "must contain at least one special character")
		}
	}

	if len(violations) == 0 {
		return nil
	}

	var errs []error
	for _, v := range violations {
		errs = append(errs, errors.New(v))
	}
	return fmt.Errorf("password policy violation: %w", errors.Join(errs...))
}
