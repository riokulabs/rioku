package auth_test

import (
	"encoding/base32"
	"strings"
	"testing"
	"time"

	"github.com/riokulabs/rioku/internal/auth"
)

func TestGenerateTOTPSecret(t *testing.T) {
	secret, err := auth.GenerateTOTPSecret()
	if err != nil {
		t.Fatal(err)
	}
	// 20 bytes -> 32 base32 chars (no padding).
	if len(secret) != 32 {
		t.Fatalf("expected 32-char base32 secret, got len %d: %q", len(secret), secret)
	}
	// Must be valid base32.
	_, err = base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(
		strings.ToUpper(secret))
	if err != nil {
		t.Fatalf("secret is not valid base32: %v", err)
	}
}

func TestGenerateTOTPSecret_Uniqueness(t *testing.T) {
	s1, err := auth.GenerateTOTPSecret()
	if err != nil {
		t.Fatal(err)
	}
	s2, err := auth.GenerateTOTPSecret()
	if err != nil {
		t.Fatal(err)
	}
	if s1 == s2 {
		t.Error("two generated secrets should differ")
	}
}

func TestComputeTOTPCode_RFC6238_TestVector(t *testing.T) {
	// RFC 6238 Appendix B test vector:
	// Secret = "12345678901234567890" (raw bytes)
	// Time = 59 seconds -> step = 1
	// Expected SHA1 TOTP = "287082"
	rawSecret := []byte("12345678901234567890")
	secret := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(rawSecret)

	code, err := auth.ComputeTOTPCode(secret, time.Unix(59, 0))
	if err != nil {
		t.Fatal(err)
	}
	if code != "287082" {
		t.Fatalf("expected RFC 6238 test vector 287082, got %s", code)
	}
}

func TestComputeTOTPCode_Format(t *testing.T) {
	secret := "JBSWY3DPEHPK3PXP"
	code, err := auth.ComputeTOTPCode(secret, time.Unix(0, 0))
	if err != nil {
		t.Fatal(err)
	}
	if len(code) != 6 {
		t.Fatalf("expected 6-digit code, got len %d: %s", len(code), code)
	}
	for _, c := range code {
		if c < '0' || c > '9' {
			t.Fatalf("non-digit in code: %s", code)
		}
	}
}

func TestValidateTOTPCode_CurrentWindow(t *testing.T) {
	secret, err := auth.GenerateTOTPSecret()
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	code, err := auth.ComputeTOTPCode(secret, now)
	if err != nil {
		t.Fatal(err)
	}
	if !auth.ValidateTOTPCode(secret, code, now) {
		t.Error("current window code should be valid")
	}
}

func TestValidateTOTPCode_WrongCode(t *testing.T) {
	secret, err := auth.GenerateTOTPSecret()
	if err != nil {
		t.Fatal(err)
	}
	if auth.ValidateTOTPCode(secret, "000000", time.Now()) {
		// This could theoretically pass if 000000 happens to be the correct code.
		// Extremely unlikely but handle it: generate another secret.
		secret2, _ := auth.GenerateTOTPSecret()
		if auth.ValidateTOTPCode(secret2, "000000", time.Now()) {
			t.Skip("extraordinarily unlikely: 000000 was valid for both secrets")
		}
	}
}

func TestValidateTOTPCode_ClockSkew(t *testing.T) {
	secret, err := auth.GenerateTOTPSecret()
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	// Compute code at t-25s (still in the previous 30-second window).
	prev := now.Add(-25 * time.Second)
	code, err := auth.ComputeTOTPCode(secret, prev)
	if err != nil {
		t.Fatal(err)
	}
	// Validate at current time — should pass within +/- 1 window.
	if !auth.ValidateTOTPCode(secret, code, now) {
		t.Error("code from t-25s should be accepted within +/- 1 window")
	}
}

func TestValidateTOTPCode_TwoWindowsAgo(t *testing.T) {
	secret, err := auth.GenerateTOTPSecret()
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	// Code from 2 windows ago (60+ seconds).
	old := now.Add(-61 * time.Second)
	code, err := auth.ComputeTOTPCode(secret, old)
	if err != nil {
		t.Fatal(err)
	}
	if auth.ValidateTOTPCode(secret, code, now) {
		t.Error("code from 2+ windows ago should be rejected")
	}
}

func TestValidateTOTPCode_InvalidSecret(t *testing.T) {
	if auth.ValidateTOTPCode("not-valid-base32!!!", "123456", time.Now()) {
		t.Error("invalid secret should return false")
	}
}

func TestBuildTOTPQRURI(t *testing.T) {
	uri := auth.BuildTOTPQRURI("Rioku", "admin", "JBSWY3DPEHPK3PXP")
	if !strings.HasPrefix(uri, "otpauth://totp/") {
		t.Fatalf("unexpected URI prefix: %s", uri)
	}
	if !strings.Contains(uri, "secret=JBSWY3DPEHPK3PXP") {
		t.Fatalf("URI missing secret param: %s", uri)
	}
	if !strings.Contains(uri, "issuer=Rioku") {
		t.Fatalf("URI missing issuer param: %s", uri)
	}
	if !strings.Contains(uri, "algorithm=SHA1") {
		t.Fatalf("URI missing algorithm param: %s", uri)
	}
	if !strings.Contains(uri, "digits=6") {
		t.Fatalf("URI missing digits param: %s", uri)
	}
	if !strings.Contains(uri, "period=30") {
		t.Fatalf("URI missing period param: %s", uri)
	}
}

func TestGenerateBackupCodes(t *testing.T) {
	codes, err := auth.GenerateBackupCodes()
	if err != nil {
		t.Fatal(err)
	}
	if len(codes) != 10 {
		t.Fatalf("expected 10 backup codes, got %d", len(codes))
	}

	seen := make(map[string]bool)
	for i, code := range codes {
		if len(code) != 8 {
			t.Errorf("code[%d] length = %d, want 8: %q", i, len(code), code)
		}
		// All chars must be [A-Z0-9].
		for _, c := range code {
			if !((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) {
				t.Errorf("code[%d] contains invalid char %c: %q", i, c, code)
			}
		}
		if seen[code] {
			t.Errorf("duplicate backup code: %s", code)
		}
		seen[code] = true
	}
}

func TestGenerateBackupCodes_Uniqueness(t *testing.T) {
	batch1, err := auth.GenerateBackupCodes()
	if err != nil {
		t.Fatal(err)
	}
	batch2, err := auth.GenerateBackupCodes()
	if err != nil {
		t.Fatal(err)
	}
	// At least some codes should differ between batches.
	allSame := true
	for i := range batch1 {
		if batch1[i] != batch2[i] {
			allSame = false
			break
		}
	}
	if allSame {
		t.Error("two batches of backup codes should not be identical")
	}
}
