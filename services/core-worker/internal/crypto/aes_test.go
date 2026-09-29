package crypto

import (
	"crypto/rand"
	"encoding/hex"
	"testing"
)

func TestGCMEncryptor_Roundtrip(t *testing.T) {
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatalf("failed to generate random key: %v", err)
	}

	encryptor, err := NewGCMEncryptor(string(key))
	if err != nil {
		t.Fatalf("failed to create encryptor: %v", err)
	}

	secretToken := "EAAG_test_instagram_token_super_secret_value_12345"
	ct, nonce, err := encryptor.EncryptString(secretToken)
	if err != nil {
		t.Fatalf("failed to encrypt: %v", err)
	}

	if ct == "" || nonce == "" {
		t.Fatalf("ciphertext or nonce should not be empty")
	}

	decrypted, err := encryptor.DecryptString(ct, nonce)
	if err != nil {
		t.Fatalf("failed to decrypt: %v", err)
	}

	if decrypted != secretToken {
		t.Fatalf("expected decrypted string %s, got %s", secretToken, decrypted)
	}
}

func TestGCMEncryptor_HexKey(t *testing.T) {
	rawKey := make([]byte, 32)
	rand.Read(rawKey)
	hexKey := hex.EncodeToString(rawKey)

	encryptor, err := NewGCMEncryptor(hexKey)
	if err != nil {
		t.Fatalf("failed to create encryptor from hex key: %v", err)
	}

	ct, nonce, err := encryptor.EncryptString("hello world")
	if err != nil {
		t.Fatalf("failed to encrypt: %v", err)
	}

	dt, err := encryptor.DecryptString(ct, nonce)
	if err != nil {
		t.Fatalf("failed to decrypt: %v", err)
	}
	if dt != "hello world" {
		t.Fatalf("expected 'hello world', got '%s'", dt)
	}
}

func TestGCMEncryptor_InvalidKeySize(t *testing.T) {
	shortKey := "too_short_key_16b"
	_, err := NewGCMEncryptor(shortKey)
	if err != ErrInvalidKeySize {
		t.Fatalf("expected ErrInvalidKeySize, got %v", err)
	}
}

func TestGCMEncryptor_TamperDetection(t *testing.T) {
	key := make([]byte, 32)
	rand.Read(key)

	encryptor, err := NewGCMEncryptor(string(key))
	if err != nil {
		t.Fatalf("failed to create encryptor: %v", err)
	}

	ct, nonce, err := encryptor.EncryptString("authentic data")
	if err != nil {
		t.Fatalf("failed to encrypt: %v", err)
	}

	// Tamper with ciphertext by corrupting characters
	tamperedCtBytes := []byte(ct)
	if tamperedCtBytes[0] == 'A' {
		tamperedCtBytes[0] = 'B'
	} else {
		tamperedCtBytes[0] = 'A'
	}
	tamperedCt := string(tamperedCtBytes)
	_, err = encryptor.DecryptString(tamperedCt, nonce)
	if err == nil {
		t.Fatalf("expected error on tampered ciphertext, got nil")
	}

	// Tamper with nonce
	tamperedNonceBytes := []byte(nonce)
	if tamperedNonceBytes[0] == 'B' {
		tamperedNonceBytes[0] = 'C'
	} else {
		tamperedNonceBytes[0] = 'B'
	}
	tamperedNonce := string(tamperedNonceBytes)
	_, err = encryptor.DecryptString(ct, tamperedNonce)
	if err == nil {
		t.Fatalf("expected error on tampered nonce, got nil")
	}
}

func TestGCMEncryptor_WrongKeyRejection(t *testing.T) {
	key1 := make([]byte, 32)
	key2 := make([]byte, 32)
	rand.Read(key1)
	rand.Read(key2)

	enc1, _ := NewGCMEncryptor(string(key1))
	enc2, _ := NewGCMEncryptor(string(key2))

	ct, nonce, _ := enc1.EncryptString("secret")
	_, err := enc2.DecryptString(ct, nonce)
	if err != ErrDecryptionFailed {
		t.Fatalf("expected ErrDecryptionFailed when decrypting with wrong key, got %v", err)
	}
}
