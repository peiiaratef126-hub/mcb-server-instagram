package token

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"time"

	"github.com/peiiaratef126-hub/mcb-server-instagram/services/core-worker/internal/crypto"
	"github.com/peiiaratef126-hub/mcb-server-instagram/services/core-worker/internal/db"
)

var (
	ErrNoActiveToken   = errors.New("no active token found for account")
	ErrTokenExpired    = errors.New("active token has expired")
	ErrRefreshRejected = errors.New("meta graph api rejected token refresh")
)

type Config struct {
	AccountID     string
	AppID         string
	AppSecret     string
	GraphVersion  string
	EncryptionKey string
	BaseURL       string // Default: "https://graph.facebook.com"
	HTTPClient    *http.Client
}

type TokenMetadata struct {
	AccountID       string     `json:"account_id"`
	Scopes          []string   `json:"scopes"`
	ExpiresAt       *time.Time `json:"expires_at,omitempty"`
	LastRefreshedAt time.Time  `json:"last_refreshed_at"`
}

type TokenResponse struct {
	AccountID   string     `json:"account_id"`
	AccessToken string     `json:"access_token"`
	ExpiresAt   *time.Time `json:"expires_at,omitempty"`
}

type Service struct {
	repo       db.Repository
	encryptor  *crypto.GCMEncryptor
	cfg        Config
	httpClient *http.Client
}

func NewService(repo db.Repository, cfg Config) (*Service, error) {
	if cfg.AccountID == "" {
		return nil, errors.New("account ID is required")
	}
	if cfg.EncryptionKey == "" {
		return nil, errors.New("encryption key is required")
	}
	if cfg.GraphVersion == "" {
		cfg.GraphVersion = "v21.0"
	}
	if cfg.BaseURL == "" {
		cfg.BaseURL = "https://graph.facebook.com"
	}

	enc, err := crypto.NewGCMEncryptor(cfg.EncryptionKey)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize encryptor: %w", err)
	}

	client := cfg.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}

	return &Service{
		repo:       repo,
		encryptor:  enc,
		cfg:        cfg,
		httpClient: client,
	}, nil
}

// InitializeFromEnv checks if a token exists in DB. If not, imports and encrypts envToken.
func (s *Service) InitializeFromEnv(ctx context.Context, envToken string) error {
	existing, err := s.repo.GetAccessToken(ctx, s.cfg.AccountID)
	if err == nil && existing != nil {
		slog.Info("Active token already exists in database; skipping environment migration", "account_id", s.cfg.AccountID)
		return nil
	}
	if err != nil && !errors.Is(err, db.ErrNotFound) {
		return fmt.Errorf("failed to check existing token: %w", err)
	}

	if envToken == "" {
		slog.Warn("No existing token in database and no environment token provided to import", "account_id", s.cfg.AccountID)
		return nil
	}

	slog.Info("Importing and encrypting access token from environment into database...", "account_id", s.cfg.AccountID)
	ct, nonce, err := s.encryptor.EncryptString(envToken)
	if err != nil {
		return fmt.Errorf("failed to encrypt environment token: %w", err)
	}

	now := time.Now().UTC()
	// Assume 60 days standard lifespan for newly imported long-lived tokens
	expiresAt := now.Add(60 * 24 * time.Hour)

	record := &db.AccessToken{
		AccountID:       s.cfg.AccountID,
		TokenCiphertext: ct,
		Nonce:           nonce,
		KeyID:           "v1",
		Scopes:          []string{"instagram_basic", "instagram_manage_comments", "pages_show_list"},
		ExpiresAt:       &expiresAt,
		LastRefreshedAt: now,
		CreatedAt:       now,
		UpdatedAt:       now,
	}

	if err := s.repo.SaveAccessToken(ctx, record); err != nil {
		return fmt.Errorf("failed to save encrypted token to database: %w", err)
	}

	slog.Info("Access token successfully encrypted and persisted in database", "account_id", s.cfg.AccountID)
	return nil
}

// GetActiveToken retrieves, decrypts, and validates the active Instagram token.
func (s *Service) GetActiveToken(ctx context.Context) (string, error) {
	record, err := s.repo.GetAccessToken(ctx, s.cfg.AccountID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			return "", ErrNoActiveToken
		}
		return "", fmt.Errorf("failed to query access token: %w", err)
	}

	if record.ExpiresAt != nil && time.Now().UTC().After(*record.ExpiresAt) {
		return "", ErrTokenExpired
	}

	plaintext, err := s.encryptor.DecryptString(record.TokenCiphertext, record.Nonce)
	if err != nil {
		return "", fmt.Errorf("failed to decrypt access token: %w", err)
	}

	return plaintext, nil
}

// GetTokenMetadata returns token metadata without exposing the decrypted secret.
func (s *Service) GetTokenMetadata(ctx context.Context) (*TokenMetadata, error) {
	record, err := s.repo.GetAccessToken(ctx, s.cfg.AccountID)
	if err != nil {
		return nil, err
	}

	return &TokenMetadata{
		AccountID:       record.AccountID,
		Scopes:          record.Scopes,
		ExpiresAt:       record.ExpiresAt,
		LastRefreshedAt: record.LastRefreshedAt,
	}, nil
}

type metaRefreshResponse struct {
	AccessToken string `json:"access_token"`
	TokenType   string `json:"token_type"`
	ExpiresIn   int64  `json:"expires_in"` // seconds
	Error       *struct {
		Message string `json:"message"`
		Code    int    `json:"code"`
	} `json:"error,omitempty"`
}

// RefreshToken exchanges current token for a refreshed 60-day token via Meta Graph API fb_exchange_token.
func (s *Service) RefreshToken(ctx context.Context) error {
	if s.cfg.AppID == "" || s.cfg.AppSecret == "" {
		return errors.New("app ID and app secret are required to refresh tokens")
	}

	currentToken, err := s.GetActiveToken(ctx)
	if err != nil {
		return fmt.Errorf("cannot refresh token: %w", err)
	}

	reqURL, err := url.Parse(fmt.Sprintf("%s/%s/oauth/access_token", s.cfg.BaseURL, s.cfg.GraphVersion))
	if err != nil {
		return fmt.Errorf("invalid graph url: %w", err)
	}

	q := reqURL.Query()
	q.Set("grant_type", "fb_exchange_token")
	q.Set("client_id", s.cfg.AppID)
	q.Set("client_secret", s.cfg.AppSecret)
	q.Set("fb_exchange_token", currentToken)
	reqURL.RawQuery = q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL.String(), nil)
	if err != nil {
		return fmt.Errorf("failed to build refresh request: %w", err)
	}
	req.Header.Set("Accept", "application/json")

	slog.Info("Requesting token refresh from Meta Graph API...", "account_id", s.cfg.AccountID, "version", s.cfg.GraphVersion)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("network error during token refresh: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to read refresh response: %w", err)
	}

	var metaResp metaRefreshResponse
	if err := json.Unmarshal(body, &metaResp); err != nil {
		return fmt.Errorf("failed to parse refresh response: %w", err)
	}

	if resp.StatusCode != http.StatusOK || metaResp.AccessToken == "" {
		errMsg := "unknown error"
		if metaResp.Error != nil && metaResp.Error.Message != "" {
			errMsg = metaResp.Error.Message
		}
		slog.Error("Meta Graph API rejected token refresh", "status", resp.StatusCode, "error", errMsg)
		return fmt.Errorf("%w: %s (status %d)", ErrRefreshRejected, errMsg, resp.StatusCode)
	}

	// Encrypt new token and update DB
	ct, nonce, err := s.encryptor.EncryptString(metaResp.AccessToken)
	if err != nil {
		return fmt.Errorf("failed to encrypt refreshed token: %w", err)
	}

	now := time.Now().UTC()
	var expiresAt *time.Time
	if metaResp.ExpiresIn > 0 {
		exp := now.Add(time.Duration(metaResp.ExpiresIn) * time.Second)
		expiresAt = &exp
	}

	record, err := s.repo.GetAccessToken(ctx, s.cfg.AccountID)
	if err != nil && !errors.Is(err, db.ErrNotFound) {
		return fmt.Errorf("failed to retrieve token record for update: %w", err)
	}

	scopes := []string{"instagram_basic", "instagram_manage_comments", "pages_show_list"}
	if record != nil && len(record.Scopes) > 0 {
		scopes = record.Scopes
	}

	updated := &db.AccessToken{
		AccountID:       s.cfg.AccountID,
		TokenCiphertext: ct,
		Nonce:           nonce,
		KeyID:           "v1",
		Scopes:          scopes,
		ExpiresAt:       expiresAt,
		LastRefreshedAt: now,
		UpdatedAt:       now,
	}

	if err := s.repo.SaveAccessToken(ctx, updated); err != nil {
		return fmt.Errorf("failed to persist refreshed token: %w", err)
	}

	slog.Info("Token refreshed successfully and encrypted at rest", "account_id", s.cfg.AccountID)
	return nil
}
