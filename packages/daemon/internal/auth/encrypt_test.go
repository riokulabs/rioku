package auth_test

import (
	"strings"
	"testing"

	"github.com/riokulabs/rioku/internal/auth"
)

func TestEncryptDecryptRoundTrip(t *testing.T) {
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i)
	}

	enc, err := auth.NewEncryptor(key)
	if err != nil {
		t.Fatal(err)
	}

	plaintext := "JBSWY3DPEHPK3PXP" // sample TOTP secret
	ciphertext, err := enc.Encrypt(plaintext)
	if err != nil {
		t.Fatal(err)
	}

	decrypted, err := enc.Decrypt(ciphertext)
	if err != nil {
		t.Fatal(err)
	}
	if decrypted != plaintext {
		t.Fatalf("decrypt mismatch: got %q, want %q", decrypted, plaintext)
	}
}

func TestEncryptDifferentCiphertexts(t *testing.T) {
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i)
	}
	enc, err := auth.NewEncryptor(key)
	if err != nil {
		t.Fatal(err)
	}

	c1, err := enc.Encrypt("same-input")
	if err != nil {
		t.Fatal(err)
	}
	c2, err := enc.Encrypt("same-input")
	if err != nil {
		t.Fatal(err)
	}
	if c1 == c2 {
		t.Error("two encryptions of same plaintext must differ (random nonce)")
	}
}

func TestDecryptWrongKey(t *testing.T) {
	key1 := make([]byte, 32)
	key2 := make([]byte, 32)
	key2[0] = 0xff

	enc1, err := auth.NewEncryptor(key1)
	if err != nil {
		t.Fatal(err)
	}
	enc2, err := auth.NewEncryptor(key2)
	if err != nil {
		t.Fatal(err)
	}

	ciphertext, err := enc1.Encrypt("secret data")
	if err != nil {
		t.Fatal(err)
	}

	_, err = enc2.Decrypt(ciphertext)
	if err == nil {
		t.Fatal("expected error decrypting with wrong key")
	}
}

func TestDecryptCorrupted(t *testing.T) {
	key := make([]byte, 32)
	enc, err := auth.NewEncryptor(key)
	if err != nil {
		t.Fatal(err)
	}

	ciphertext, err := enc.Encrypt("secret data")
	if err != nil {
		t.Fatal(err)
	}

	// Corrupt the ciphertext by replacing a base64 character in the body with
	// one that is guaranteed to be different from the original. Picking 'X'
	// blindly was a 1/64 chance of no-op when position 4 already held 'X'.
	b := []byte(ciphertext)
	if b[4] == 'X' {
		b[4] = 'Y'
	} else {
		b[4] = 'X'
	}
	corrupted := string(b)

	_, err = enc.Decrypt(corrupted)
	if err == nil {
		t.Fatal("expected error decrypting corrupted ciphertext")
	}
}

func TestVersionPrefix(t *testing.T) {
	key := make([]byte, 32)
	enc, err := auth.NewEncryptor(key)
	if err != nil {
		t.Fatal(err)
	}

	ciphertext, err := enc.Encrypt("test")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(ciphertext, "v1:") {
		t.Fatalf("expected v1: prefix, got %q", ciphertext)
	}
}

func TestDecryptUnknownVersion(t *testing.T) {
	key := make([]byte, 32)
	enc, err := auth.NewEncryptor(key)
	if err != nil {
		t.Fatal(err)
	}

	_, err = enc.Decrypt("v2:someinvaliddata")
	if err == nil {
		t.Fatal("expected error for unknown version prefix")
	}
}

func TestNewEncryptorWrongKeySize(t *testing.T) {
	_, err := auth.NewEncryptor(make([]byte, 16))
	if err == nil {
		t.Fatal("expected error for 16-byte key")
	}
}

func TestDeriveEncryptionKey(t *testing.T) {
	signingKey := make([]byte, 32)
	salt := make([]byte, 16)

	k1, err := auth.DeriveEncryptionKey(signingKey, salt)
	if err != nil {
		t.Fatal(err)
	}
	k2, err := auth.DeriveEncryptionKey(signingKey, salt)
	if err != nil {
		t.Fatal(err)
	}
	if string(k1) != string(k2) {
		t.Error("same signing key + salt must produce same encryption key")
	}

	if len(k1) != 32 {
		t.Errorf("expected 32-byte key, got %d", len(k1))
	}

	// Different salt -> different key.
	salt2 := make([]byte, 16)
	salt2[0] = 1
	k3, err := auth.DeriveEncryptionKey(signingKey, salt2)
	if err != nil {
		t.Fatal(err)
	}
	if string(k1) == string(k3) {
		t.Error("different salts must produce different keys")
	}
}

func TestEncryptFieldDecryptField(t *testing.T) {
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i + 10)
	}

	ciphertext, err := auth.EncryptField("hello world", key)
	if err != nil {
		t.Fatal(err)
	}

	plaintext, err := auth.DecryptField(ciphertext, key)
	if err != nil {
		t.Fatal(err)
	}
	if plaintext != "hello world" {
		t.Fatalf("got %q, want %q", plaintext, "hello world")
	}
}
