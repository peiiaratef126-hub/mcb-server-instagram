package token

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/peiiaratef126-hub/mcb-server-instagram/services/core-worker/internal/db"
)

func generateTestKey(t *testing.T) string {
	t.Helper()
	k := make([]byte, 32)
	if _, err := rand.Read(k); err != nil {
		t.Fatalf("failed to generate random key: %v", err)
	}
	return string(k)
}

func TestTokenService_InitializeFromEnv(t *testing.T) {
	ctx := context.Background()
	repo := db.NewMemoryRepository()
	encKey := generateTestKey(t)

	svc, err := NewService(repo, Config{
		AccountID:     "17841400000000001",
		AppID:         "test_app_id",
		AppSecret:     "test_app_secret",
		EncryptionKey: encKey,
	})
	if err != nil {
		t.Fatalf("failed to create service: %v", err)
	}

	envToken := "EAAG_initial_boot_token_from_env_998877"

	// 1. Initial import from env
	if err := svc.InitializeFromEnv(ctx, envToken); err != nil {
		t.Fatalf("failed to initialize from env: %v", err)
	}

	// 2. Verify token was encrypted at rest
	stored, err := repo.GetAccessToken(ctx, "17841400000000001")
	if err != nil {
		t.Fatalf("failed to get stored token: %v", err)
	}
	if stored.TokenCiphertext == envToken {
		t.Fatalf("token stored in plaintext! Expected ciphertext")
	}
	if stored.Nonce == "" {
		t.Fatalf("nonce should not be empty")
	}

	// 3. Verify GetActiveToken decrypts correctly
	activeToken, err := svc.GetActiveToken(ctx)
	if err != nil {
		t.Fatalf("failed to get active token: %v", err)
	}
	if activeToken != envToken {
		t.Fatalf("expected decrypted token %s, got %s", envToken, activeToken)
	}

	// 4. Repeated InitializeFromEnv should not overwrite
	if err := svc.InitializeFromEnv(ctx, "different_token"); err != nil {
		t.Fatalf("failed on repeated initialize: %v", err)
	}
	activeToken2, _ := svc.GetActiveToken(ctx)
	if activeToken2 != envToken {
		t.Fatalf("token should not have been overwritten by repeated initialize")
	}
}

func TestTokenService_RefreshToken(t *testing.T) {
	ctx := context.Background()
	repo := db.NewMemoryRepository()
	encKey := generateTestKey(t)

	refreshedToken := "EAAG_refreshed_long_lived_token_112233"

	// Mock Meta Graph API server
	mockMetaServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		grantType := r.URL.Query().Get("grant_type")
		if grantType != "fb_exchange_token" {
			http.Error(w, `{"error":{"message":"Invalid grant type"}}`, http.StatusBadRequest)
			return
		}
		resp := metaRefreshResponse{
			AccessToken: refreshedToken,
			TokenType:   "bearer",
			ExpiresIn:   5184000, // 60 days
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer mockMetaServer.Close()

	svc, err := NewService(repo, Config{
		AccountID:     "17841400000000001",
		AppID:         "test_app_id",
		AppSecret:     "test_app_secret",
		EncryptionKey: encKey,
		BaseURL:       mockMetaServer.URL,
		HTTPClient:    mockMetaServer.Client(),
	})
	if err != nil {
		t.Fatalf("failed to create service: %v", err)
	}

	// Initialize with initial token
	_ = svc.InitializeFromEnv(ctx, "initial_token")

	// Trigger refresh
	if err := svc.RefreshToken(ctx); err != nil {
		t.Fatalf("failed to refresh token: %v", err)
	}

	// Verify active token is now the refreshed token
	active, err := svc.GetActiveToken(ctx)
	if err != nil {
		t.Fatalf("failed to get active token: %v", err)
	}
	if active != refreshedToken {
		t.Fatalf("expected active token %s, got %s", refreshedToken, active)
	}

	// Verify metadata shows new expiration ~60 days out
	meta, err := svc.GetTokenMetadata(ctx)
	if err != nil {
		t.Fatalf("failed to get metadata: %v", err)
	}
	if meta.ExpiresAt == nil || time.Until(*meta.ExpiresAt) < 59*24*time.Hour {
		t.Fatalf("expected expiration ~60 days, got %v", meta.ExpiresAt)
	}
}

func TestTokenServer_InternalEndpoint(t *testing.T) {
	ctx := context.Background()
	repo := db.NewMemoryRepository()
	encKey := generateTestKey(t)

	svc, _ := NewService(repo, Config{
		AccountID:     "17841400000000001",
		AppID:         "test_app_id",
		AppSecret:     "test_app_secret",
		EncryptionKey: encKey,
	})
	_ = svc.InitializeFromEnv(ctx, "secret_ig_token_abc")

	srv := NewServer(svc, "127.0.0.1:0")

	// Test GET /internal/token
	req := httptest.NewRequest(http.MethodGet, "/internal/token", nil)
	rec := httptest.NewRecorder()

	srv.httpSrv.Handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d. Body: %s", rec.Code, rec.Body.String())
	}

	var resp TokenResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse json response: %v", err)
	}
	if resp.AccessToken != "secret_ig_token_abc" {
		t.Fatalf("expected secret_ig_token_abc, got %s", resp.AccessToken)
	}
	if resp.AccountID != "17841400000000001" {
		t.Fatalf("expected account ID 17841400000000001, got %s", resp.AccountID)
	}

	// Test GET /healthz
	reqHealth := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	recHealth := httptest.NewRecorder()
	srv.httpSrv.Handler.ServeHTTP(recHealth, reqHealth)
	if recHealth.Code != http.StatusOK {
		t.Fatalf("expected healthz status 200, got %d", recHealth.Code)
	}
}
