package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1" //nolint:gosec // SHA1 is required by RFC 6238 TOTP spec
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"net/url"
	"strings"
	"time"
)

const (
	totpDigits    = 6
	totpPeriod    = 30 // seconds
	totpWindow    = 1  // +/- 1 period allowed for clock skew
	totpSecretLen = 20 // bytes

	backupCodeCount  = 10
	backupCodeLength = 8
)

// backupCodeAlphabet is the character set for backup codes: uppercase + digits.
const backupCodeAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

// GenerateTOTPSecret generates a random 20-byte TOTP secret and returns it
// as an uppercase base32 string (no padding) suitable for QR codes.
func GenerateTOTPSecret() (string, error) {
	b := make([]byte, totpSecretLen)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("auth: generate TOTP secret: %w", err)
	}
	return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(b), nil
}

// ComputeTOTPCode computes the 6-digit TOTP code for the given base32 secret
// at the given time, per RFC 6238 (HMAC-SHA1, 30-second time step).
func ComputeTOTPCode(secret string, t time.Time) (string, error) {
	key, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(
		strings.ToUpper(secret))
	if err != nil {
		return "", fmt.Errorf("auth: decode TOTP secret: %w", err)
	}
	return computeHOTP(key, uint64(t.Unix())/totpPeriod), nil
}

// computeHOTP computes an HOTP code (RFC 4226) for the given key and counter.
func computeHOTP(key []byte, counter uint64) string {
	msg := make([]byte, 8)
	binary.BigEndian.PutUint64(msg, counter)

	h := hmac.New(sha1.New, key) //nolint:gosec // required by RFC 6238
	h.Write(msg)
	sum := h.Sum(nil)

	// Dynamic truncation (RFC 4226 section 5.3).
	offset := sum[len(sum)-1] & 0x0f
	truncated := binary.BigEndian.Uint32(sum[offset:offset+4]) & 0x7fffffff
	code := truncated % 1000000

	return fmt.Sprintf("%06d", code)
}

// ValidateTOTPCode validates a 6-digit code against the given secret at time t.
// Accepts the current period and +/- 1 period to handle clock skew (90-second
// total window). Uses constant-time comparison via hmac.Equal.
func ValidateTOTPCode(secret, code string, t time.Time) bool {
	key, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(
		strings.ToUpper(secret))
	if err != nil {
		return false
	}
	step := uint64(t.Unix()) / totpPeriod
	for delta := -totpWindow; delta <= totpWindow; delta++ {
		candidate := computeHOTP(key, uint64(int64(step)+int64(delta)))
		if hmac.Equal([]byte(candidate), []byte(code)) {
			return true
		}
	}
	return false
}

// BuildTOTPQRURI constructs an otpauth:// URI for QR code display.
// issuer is typically "Rioku", account is the username.
func BuildTOTPQRURI(issuer, account, secret string) string {
	label := url.PathEscape(issuer + ":" + account)
	params := url.Values{}
	params.Set("secret", secret)
	params.Set("issuer", issuer)
	params.Set("algorithm", "SHA1")
	params.Set("digits", "6")
	params.Set("period", "30")
	return "otpauth://totp/" + label + "?" + params.Encode()
}

// GenerateBackupCodes creates 10 random 8-character alphanumeric backup codes.
// Characters are drawn from [A-Z0-9].
func GenerateBackupCodes() ([]string, error) {
	codes := make([]string, backupCodeCount)
	for i := 0; i < backupCodeCount; i++ {
		code, err := generateRandomCode(backupCodeLength)
		if err != nil {
			return nil, fmt.Errorf("auth: generate backup code: %w", err)
		}
		codes[i] = code
	}
	return codes, nil
}

// generateRandomCode generates a random string of the given length from
// the backupCodeAlphabet using crypto/rand.
func generateRandomCode(length int) (string, error) {
	b := make([]byte, length)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	for i := range b {
		b[i] = backupCodeAlphabet[int(b[i])%len(backupCodeAlphabet)]
	}
	return string(b), nil
}
