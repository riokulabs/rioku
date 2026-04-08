package auth

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"strings"

	"golang.org/x/crypto/hkdf"
)

const encryptionInfoStr = "rioku-field-encryption-v1"

// DeriveEncryptionKey derives a 32-byte AES-256 key from a master key using
// HKDF-SHA256. The salt should be stable across restarts (stored alongside the
// signing key). The info string is fixed to "rioku-field-encryption-v1".
func DeriveEncryptionKey(masterKey, salt []byte) ([]byte, error) {
	r := hkdf.New(sha256.New, masterKey, salt, []byte(encryptionInfoStr))
	key := make([]byte, 32)
	if _, err := io.ReadFull(r, key); err != nil {
		return nil, fmt.Errorf("auth: derive encryption key: %w", err)
	}
	return key, nil
}

// Encryptor encrypts and decrypts field values using AES-256-GCM.
// Used to protect TOTP secrets and other sensitive data at rest.
type Encryptor struct {
	key []byte
}

// NewEncryptor creates an Encryptor with the given 32-byte AES key.
// Use DeriveEncryptionKey to obtain the key from the daemon's signing key.
func NewEncryptor(key []byte) (*Encryptor, error) {
	if len(key) != 32 {
		return nil, fmt.Errorf("auth: encryption key must be 32 bytes, got %d", len(key))
	}
	return &Encryptor{key: key}, nil
}

// Encrypt encrypts a plaintext string and returns a versioned, base64-encoded
// ciphertext. Format: "v1:<base64(nonce + ciphertext + GCM tag)>"
func (e *Encryptor) Encrypt(plaintext string) (string, error) {
	block, err := aes.NewCipher(e.key)
	if err != nil {
		return "", fmt.Errorf("auth: create cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("auth: create GCM: %w", err)
	}

	nonce := make([]byte, gcm.NonceSize()) // 12 bytes
	if _, err := rand.Read(nonce); err != nil {
		return "", fmt.Errorf("auth: generate nonce: %w", err)
	}

	// gcm.Seal appends ciphertext+tag to nonce, so sealed = nonce + ciphertext + tag.
	sealed := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return "v1:" + base64.StdEncoding.EncodeToString(sealed), nil
}

// Decrypt decrypts a versioned ciphertext produced by Encrypt.
func (e *Encryptor) Decrypt(ciphertext string) (string, error) {
	if !strings.HasPrefix(ciphertext, "v1:") {
		return "", fmt.Errorf("auth: unknown ciphertext version: %q", ciphertext)
	}

	data, err := base64.StdEncoding.DecodeString(ciphertext[3:])
	if err != nil {
		return "", fmt.Errorf("auth: base64 decode: %w", err)
	}

	block, err := aes.NewCipher(e.key)
	if err != nil {
		return "", fmt.Errorf("auth: create cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("auth: create GCM: %w", err)
	}

	nonceSize := gcm.NonceSize()
	if len(data) < nonceSize {
		return "", fmt.Errorf("auth: ciphertext too short")
	}

	nonce, data := data[:nonceSize], data[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, data, nil)
	if err != nil {
		return "", fmt.Errorf("auth: decrypt: %w", err)
	}
	return string(plaintext), nil
}

// EncryptField is a convenience function that encrypts a plaintext string
// using the provided master key. It derives an AES key via HKDF and encrypts.
func EncryptField(plaintext string, masterKey []byte) (string, error) {
	enc, err := NewEncryptor(masterKey)
	if err != nil {
		return "", err
	}
	return enc.Encrypt(plaintext)
}

// DecryptField is a convenience function that decrypts a "v1:" prefixed
// ciphertext using the provided master key.
func DecryptField(ciphertext string, masterKey []byte) (string, error) {
	enc, err := NewEncryptor(masterKey)
	if err != nil {
		return "", err
	}
	return enc.Decrypt(ciphertext)
}
