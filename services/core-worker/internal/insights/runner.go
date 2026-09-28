package insights

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/peiiaratef126-hub/mcb-server-instagram/services/core-worker/internal/db"
)

// TokenProvider defines a function that provides an active, decrypted Instagram token.
type TokenProvider func(ctx context.Context) (string, error)

type SnapshotRunner struct {
	repo          db.Repository
	client        Client
	tokenProvider TokenProvider
	accountID     string
}

func NewSnapshotRunner(repo db.Repository, client Client, tokenProvider TokenProvider, accountID string) *SnapshotRunner {
	return &SnapshotRunner{
		repo:          repo,
		client:        client,
		tokenProvider: tokenProvider,
		accountID:     accountID,
	}
}

// TakeSnapshot queries current account insights and recent media, serializes them, and persists to insights_snapshots.
func (r *SnapshotRunner) TakeSnapshot(ctx context.Context, snapshotDate time.Time) (*db.InsightsSnapshot, error) {
	truncDate := time.Date(snapshotDate.Year(), snapshotDate.Month(), snapshotDate.Day(), 0, 0, 0, 0, time.UTC)

	token, err := r.tokenProvider(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to obtain active token for insights snapshot: %w", err)
	}

	slog.Info("Collecting daily insights snapshot...", "account_id", r.accountID, "date", truncDate.Format("2006-01-02"))

	accountMetrics, err := r.client.GetAccountMetrics(ctx, r.accountID, token)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch account metrics: %w", err)
	}

	recentMedia, err := r.client.GetRecentMediaSummary(ctx, r.accountID, token, 10)
	if err != nil {
		slog.Warn("Failed to fetch recent media summary; proceeding with account metrics only", "error", err)
	}

	combinedPayload := map[string]any{
		"account_metrics": accountMetrics,
		"top_media":       recentMedia,
		"snapshot_at":     time.Now().UTC().Format(time.RFC3339),
	}

	payloadBytes, err := json.Marshal(combinedPayload)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal insights snapshot payload: %w", err)
	}

	snapshot := &db.InsightsSnapshot{
		ID:           uuid.New(),
		AccountID:    r.accountID,
		SnapshotDate: truncDate,
		Metrics:      payloadBytes,
	}

	if err := r.repo.SaveInsightsSnapshot(ctx, snapshot); err != nil {
		return nil, fmt.Errorf("failed to persist insights snapshot: %w", err)
	}

	slog.Info("Daily insights snapshot persisted successfully",
		"account_id", r.accountID,
		"date", truncDate.Format("2006-01-02"),
		"size_bytes", len(payloadBytes),
	)

	return snapshot, nil
}

// SchedulePeriodic runs a periodic loop that takes a snapshot at specified intervals.
func (r *SnapshotRunner) SchedulePeriodic(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = 24 * time.Hour
	}

	slog.Info("Starting periodic daily insights scheduler", "account_id", r.accountID, "interval", interval)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	// Initial capture on startup
	if _, err := r.TakeSnapshot(ctx, time.Now().UTC()); err != nil {
		slog.Error("Initial insights snapshot failed", "error", err)
	}

	for {
		select {
		case <-ctx.Done():
			slog.Info("Stopping daily insights scheduler", "account_id", r.accountID)
			return
		case <-ticker.C:
			if _, err := r.TakeSnapshot(ctx, time.Now().UTC()); err != nil {
				slog.Error("Scheduled insights snapshot failed", "error", err)
			}
		}
	}
}
