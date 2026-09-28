package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
)

var (
	ErrInvalidKeySize    = errors.New("encryption key must be exactly 32 bytes (or 64 hex characters)")
	ErrDecryptionFailed  = errors.New("decryption failed: ciphertext corrupted or invalid key/nonce")
	ErrEmptyInput        = errors.New("cannot encrypt or decrypt empty payload")
)

// GCMEncryptor handles AES-256-GCM authenticated encryption and decryption.
type GCMEncryptor struct {
	key []byte
}

// NewGCMEncryptor creates a new GCMEncryptor from a raw 32-byte key or hex/base64-encoded string.
func NewGCMEncryptor(rawKey string) (*GCMEncryptor, error) {
	keyBytes := []byte(rawKey)

	// If 64 hex characters, decode hex
	if len(rawKey) == 64 {
		decoded, err := hex.DecodeString(rawKey)
		if err == nil && len(decoded) == 32 {
			keyBytes = decoded
		}
	} else if len(rawKey) == 44 {
		// Possibly base64-encoded 32-byte key
		decoded, err := base64.StdEncoding.DecodeString(rawKey)
		if err == nil && len(decoded) == 32 {
			keyBytes = decoded
		}
	}

	if len(keyBytes) != 32 {
		return nil, ErrInvalidKeySize
	}

	return &GCMEncryptor{key: keyBytes}, nil
}

// Encrypt encrypts plaintext bytes using AES-256-GCM with a freshly generated 12-byte nonce.
// Returns base64-encoded ciphertext and base64-encoded nonce.
func (g *GCMEncryptor) Encrypt(plaintext []byte) (string, string, error) {
	if len(plaintext) == 0 {
		return "", "", ErrEmptyInput
	}

	block, err := aes.NewCipher(g.key)
	if err != nil {
		return "", "", fmt.Errorf("failed to create AES cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", "", fmt.Errorf("failed to create GCM block: %w", err)
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", "", fmt.Errorf("failed to generate random nonce: %w", err)
	}

	// Seal appends ciphertext and authentication tag to prefix
	ciphertext := gcm.Seal(nil, nonce, plaintext, nil)

	return base64.StdEncoding.EncodeToString(ciphertext), base64.StdEncoding.EncodeToString(nonce), nil
}

// Decrypt decrypts base64-encoded ciphertext and nonce using AES-256-GCM.
func (g *GCMEncryptor) Decrypt(ciphertextB64, nonceB64 string) ([]byte, error) {
	if ciphertextB64 == "" || nonceB64 == "" {
		return nil, ErrEmptyInput
	}

	ciphertext, err := base64.StdEncoding.DecodeString(ciphertextB64)
	if err != nil {
		return nil, fmt.Errorf("invalid base64 ciphertext: %w", err)
	}

	nonce, err := base64.StdEncoding.DecodeString(nonceB64)
	if err != nil {
		return nil, fmt.Errorf("invalid base64 nonce: %w", err)
	}

	block, err := aes.NewCipher(g.key)
	if err != nil {
		return nil, fmt.Errorf("failed to create AES cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("failed to create GCM block: %w", err)
	}

	if len(nonce) != gcm.NonceSize() {
		return nil, ErrDecryptionFailed
	}

	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, ErrDecryptionFailed
	}

	return plaintext, nil
}

// EncryptString encrypts a string and returns base64 ciphertext and nonce.
func (g *GCMEncryptor) EncryptString(plaintext string) (string, string, error) {
	return g.Encrypt([]byte(plaintext))
}

// DecryptString decrypts base64 ciphertext and nonce, returning the plaintext string.
func (g *GCMEncryptor) DecryptString(ciphertextB64, nonceB64 string) (string, error) {
	pt, err := g.Decrypt(ciphertextB64, nonceB64)
	if err != nil {
		return "", err
	}
	return string(pt), nil
}
