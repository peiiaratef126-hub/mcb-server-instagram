package handler

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/peiiaratef126-hub/mcb-server-instagram/services/gateway/internal/store"
)

type MetaWebhookPayload struct {
	Object string `json:"object"`
	Entry  []struct {
		ID      string `json:"id"`
		Time    int64  `json:"time"`
		Changes []struct {
			Field string          `json:"field"`
			Value json.RawMessage `json:"value"`
		} `json:"changes"`
		Messaging []json.RawMessage `json:"messaging"`
	} `json:"entry"`
}

type WebhookHandler struct {
	appSecret    string
	verifyToken  string
	maxBodyBytes int64
	store        store.EventStore
	logger       *slog.Logger
}

func NewWebhookHandler(
	appSecret string,
	verifyToken string,
	maxBodyBytes int64,
	store store.EventStore,
	logger *slog.Logger,
) *WebhookHandler {
	if logger == nil {
		logger = slog.Default()
	}
	if maxBodyBytes <= 0 {
		maxBodyBytes = 256 * 1024
	}
	return &WebhookHandler{
		appSecret:    appSecret,
		verifyToken:  verifyToken,
		maxBodyBytes: maxBodyBytes,
		store:        store,
		logger:       logger,
	}
}

func (h *WebhookHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/healthz" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok"}`))
		return
	}

	if r.URL.Path != "/webhook" {
		http.NotFound(w, r)
		return
	}

	switch r.Method {
	case http.MethodGet:
		h.handleVerification(w, r)
	case http.MethodPost:
		h.handleEvent(w, r)
	default:
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
	}
}

func (h *WebhookHandler) handleVerification(w http.ResponseWriter, r *http.Request) {
	mode := r.URL.Query().Get("hub.mode")
	token := r.URL.Query().Get("hub.verify_token")
	challenge := r.URL.Query().Get("hub.challenge")

	if mode != "subscribe" || h.verifyToken == "" || subtle.ConstantTimeCompare([]byte(token), []byte(h.verifyToken)) != 1 {
		h.logger.Warn("Rejected unauthorized webhook verification challenge")
		http.Error(w, "Forbidden: verification token mismatch", http.StatusForbidden)
		return
	}

	if challenge == "" {
		http.Error(w, "Bad Request: missing hub.challenge", http.StatusBadRequest)
		return
	}

	h.logger.Info("Webhook subscription handshake verified successfully")
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(challenge))
}

func (h *WebhookHandler) handleEvent(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// 1. Signature Header Inspection
	sigHeader := r.Header.Get("X-Hub-Signature-256")
	if sigHeader == "" || !strings.HasPrefix(sigHeader, "sha256=") {
		h.logger.Warn("Rejected webhook request: missing or invalid X-Hub-Signature-256 header")
		http.Error(w, "Unauthorized: missing signature header", http.StatusUnauthorized)
		return
	}
	receivedSig := strings.TrimPrefix(sigHeader, "sha256=")

	// 2. Read Body with strict MaxBytesReader
	r.Body = http.MaxBytesReader(w, r.Body, h.maxBodyBytes)
	body, err := io.ReadAll(r.Body)
	if err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			h.logger.Warn("Rejected webhook request: body exceeded maximum allowed size", "limit_bytes", h.maxBodyBytes)
			http.Error(w, "Payload Too Large", http.StatusRequestEntityTooLarge)
			return
		}
		h.logger.Warn("Failed to read webhook request body", "error", err)
		http.Error(w, "Bad Request", http.StatusBadRequest)
		return
	}

	// 3. HMAC-SHA256 Signature Verification (Constant-Time) BEFORE any processing or DB write
	if h.appSecret == "" {
		h.logger.Error("META_APP_SECRET is not configured on gateway")
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	mac := hmac.New(sha256.New, []byte(h.appSecret))
	mac.Write(body)
	expectedSig := hex.EncodeToString(mac.Sum(nil))

	if subtle.ConstantTimeCompare([]byte(receivedSig), []byte(expectedSig)) != 1 {
		h.logger.Warn("CRITICAL SECURITY: Rejected forged or invalid HMAC signature")
		http.Error(w, "Forbidden: signature verification failed", http.StatusForbidden)
		return
	}

	// 4. Parse verified payload and persist events
	var payload MetaWebhookPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		// Even if custom format, store raw verified event
		event := &store.WebhookEvent{
			ID:                uuid.New(),
			EventID:           "raw_" + uuid.New().String(),
			Field:             "instagram",
			Payload:           body,
			SignatureVerified: true,
			Processed:         false,
		}
		if storeErr := h.store.SaveEvent(ctx, event); storeErr != nil {
			h.logger.Error("Failed to store webhook event", "error", storeErr)
			http.Error(w, "Internal Server Error", http.StatusInternalServerError)
			return
		}
	} else {
		savedCount := 0
		for _, entry := range payload.Entry {
			// Process field changes (comments, mentions, etc.)
			for _, change := range entry.Changes {
				event := &store.WebhookEvent{
					ID:                uuid.New(),
					EventID:           entry.ID,
					Field:             change.Field,
					Payload:           change.Value,
					SignatureVerified: true,
					Processed:         false,
				}
				if err := h.store.SaveEvent(ctx, event); err != nil {
					h.logger.Error("Failed to store change event", "error", err, "field", change.Field)
					http.Error(w, "Internal Server Error", http.StatusInternalServerError)
					return
				}
				savedCount++
			}

			// Process direct messaging events
			for _, msg := range entry.Messaging {
				event := &store.WebhookEvent{
					ID:                uuid.New(),
					EventID:           entry.ID,
					Field:             "messages",
					Payload:           msg,
					SignatureVerified: true,
					Processed:         false,
				}
				if err := h.store.SaveEvent(ctx, event); err != nil {
					h.logger.Error("Failed to store messaging event", "error", err)
					http.Error(w, "Internal Server Error", http.StatusInternalServerError)
					return
				}
				savedCount++
			}
		}

		// If no specific changes or messaging arrays found, store top-level payload
		if savedCount == 0 {
			event := &store.WebhookEvent{
				ID:                uuid.New(),
				EventID:           "generic_" + uuid.New().String(),
				Field:             "instagram",
				Payload:           body,
				SignatureVerified: true,
				Processed:         false,
			}
			if err := h.store.SaveEvent(ctx, event); err != nil {
				h.logger.Error("Failed to store generic event", "error", err)
				http.Error(w, "Internal Server Error", http.StatusInternalServerError)
				return
			}
		}
	}

	h.logger.Info("Webhook event verified and persisted successfully")
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"received"}`))
}
