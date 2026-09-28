package handler

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/peiiaratef126-hub/mcb-server-instagram/services/gateway/internal/store"
)

const (
	testAppSecret   = "test_super_secret_meta_app_secret_123"
	testVerifyToken = "test_webhook_verification_token_456"
	testMaxBytes    = 256 * 1024 // 256 KB
)

func computeValidSignature(secret string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

func TestWebhook_HandshakeVerification(t *testing.T) {
	memStore := store.NewMemoryStore()
	h := NewWebhookHandler(testAppSecret, testVerifyToken, testMaxBytes, memStore, slog.New(slog.NewTextHandler(io.Discard, nil)))

	t.Run("Valid verification challenge returns 200 and challenge string", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/webhook?hub.mode=subscribe&hub.challenge=1158201444&hub.verify_token="+testVerifyToken, nil)
		rec := httptest.NewRecorder()

		h.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected HTTP 200, got %d (body: %s)", rec.Code, rec.Body.String())
		}
		if rec.Body.String() != "1158201444" {
			t.Fatalf("expected challenge '1158201444', got '%s'", rec.Body.String())
		}
	})

	t.Run("Invalid verification token returns 403 Forbidden", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/webhook?hub.mode=subscribe&hub.challenge=1158201444&hub.verify_token=wrong_token", nil)
		rec := httptest.NewRecorder()

		h.ServeHTTP(rec, req)

		if rec.Code != http.StatusForbidden {
			t.Fatalf("expected HTTP 403, got %d", rec.Code)
		}
	})

	t.Run("Missing challenge returns 400 Bad Request", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/webhook?hub.mode=subscribe&hub.verify_token="+testVerifyToken, nil)
		rec := httptest.NewRecorder()

		h.ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected HTTP 400, got %d", rec.Code)
		}
	})
}

// CRITICAL SECURITY TEST 1: Send a forged HMAC signature -> assert rejected before reaching DB/queue
func TestWebhook_Security_ForgedHMACSignatureRejected(t *testing.T) {
	memStore := store.NewMemoryStore()
	h := NewWebhookHandler(testAppSecret, testVerifyToken, testMaxBytes, memStore, slog.New(slog.NewTextHandler(io.Discard, nil)))

	validPayload := []byte(`{"object":"instagram","entry":[{"id":"17841400000000001","changes":[{"field":"comments","value":{"id":"123","text":"spam"}}]}]}`)

	// Compute signature using an attacker's wrong secret key
	forgedSig := computeValidSignature("attacker_wrong_secret", validPayload)

	req := httptest.NewRequest(http.MethodPost, "/webhook", bytes.NewReader(validPayload))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Hub-Signature-256", forgedSig)
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	// Must be rejected with HTTP 403 Forbidden
	if rec.Code != http.StatusForbidden {
		t.Fatalf("CRITICAL SECURITY FAILURE: Forged signature was not rejected with 403 Forbidden! Got HTTP %d (body: %s)", rec.Code, rec.Body.String())
	}

	// Must NOT reach store / database: event count must be strictly 0
	if count := memStore.Count(); count != 0 {
		t.Fatalf("CRITICAL SECURITY FAILURE: Forged payload reached store/DB! %d events were persisted!", count)
	}
}

// CRITICAL SECURITY TEST 2: Send an oversized payload -> assert rejected with HTTP 413
func TestWebhook_Security_OversizedPayloadRejected(t *testing.T) {
	memStore := store.NewMemoryStore()
	// Set small limit of 10 KB for test
	const smallLimit = 10 * 1024
	h := NewWebhookHandler(testAppSecret, testVerifyToken, smallLimit, memStore, slog.New(slog.NewTextHandler(io.Discard, nil)))

	// Create 15 KB payload (> 10 KB limit)
	oversizedBytes := make([]byte, 15*1024)
	for i := range oversizedBytes {
		oversizedBytes[i] = 'A'
	}
	oversizedPayload := []byte(fmt.Sprintf(`{"object":"instagram","data":"%s"}`, string(oversizedBytes)))
	validSig := computeValidSignature(testAppSecret, oversizedPayload)

	req := httptest.NewRequest(http.MethodPost, "/webhook", bytes.NewReader(oversizedPayload))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Hub-Signature-256", validSig)
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	// Must be rejected with HTTP 413 Payload Too Large
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("CRITICAL SECURITY FAILURE: Oversized payload was not rejected with 413! Got HTTP %d", rec.Code)
	}

	// Must NOT reach store / database: event count must be strictly 0
	if count := memStore.Count(); count != 0 {
		t.Fatalf("CRITICAL SECURITY FAILURE: Oversized payload reached store/DB! %d events were persisted!", count)
	}
}

func TestWebhook_Security_MissingSignatureHeader(t *testing.T) {
	memStore := store.NewMemoryStore()
	h := NewWebhookHandler(testAppSecret, testVerifyToken, testMaxBytes, memStore, slog.New(slog.NewTextHandler(io.Discard, nil)))

	payload := []byte(`{"object":"instagram"}`)
	req := httptest.NewRequest(http.MethodPost, "/webhook", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	// No X-Hub-Signature-256 header provided
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected HTTP 401 Unauthorized for missing signature header, got %d", rec.Code)
	}
	if memStore.Count() != 0 {
		t.Fatalf("expected 0 events in store, got %d", memStore.Count())
	}
}

func TestWebhook_Success_ValidSignatureAndPayloadPersisted(t *testing.T) {
	memStore := store.NewMemoryStore()
	h := NewWebhookHandler(testAppSecret, testVerifyToken, testMaxBytes, memStore, slog.New(slog.NewTextHandler(io.Discard, nil)))

	payload := []byte(`{
		"object": "instagram",
		"entry": [
			{
				"id": "17841400000000001",
				"time": 1727524800,
				"changes": [
					{
						"field": "comments",
						"value": {
							"id": "17999999999999999",
							"text": "Great photo!",
							"from": {"id": "17841411111111111", "username": "fan123"}
						}
					}
				],
				"messaging": [
					{
						"sender": {"id": "17841411111111111"},
						"recipient": {"id": "17841400000000001"},
						"message": {"mid": "m_123", "text": "Hello DM"}
					}
				]
			}
		]
	}`)

	sig := computeValidSignature(testAppSecret, payload)

	req := httptest.NewRequest(http.MethodPost, "/webhook", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Hub-Signature-256", sig)
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected HTTP 200, got %d (body: %s)", rec.Code, rec.Body.String())
	}

	events := memStore.GetEvents()
	if len(events) != 2 {
		t.Fatalf("expected 2 events persisted (1 comment change + 1 message), got %d", len(events))
	}

	// Verify fields and signature flag
	if events[0].Field != "comments" || !events[0].SignatureVerified || events[0].Processed {
		t.Fatalf("event 0 invalid: %+v", events[0])
	}
	if events[1].Field != "messages" || !events[1].SignatureVerified || events[1].Processed {
		t.Fatalf("event 1 invalid: %+v", events[1])
	}
}
