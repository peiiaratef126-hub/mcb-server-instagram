package insights

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/peiiaratef126-hub/mcb-server-instagram/services/core-worker/internal/db"
)

func TestSnapshotRunner_TakeSnapshot_Success(t *testing.T) {
	ctx := context.Background()
	repo := db.NewMemoryRepository()
	mockClient := &MockClient{}

	tokenProvider := func(ctx context.Context) (string, error) {
		return "EAAG_mock_valid_token", nil
	}

	runner := NewSnapshotRunner(repo, mockClient, tokenProvider, "17841400000000001")
	today := time.Now().UTC()

	snapshot, err := runner.TakeSnapshot(ctx, today)
	if err != nil {
		t.Fatalf("expected snapshot success, got err: %v", err)
	}

	if snapshot.AccountID != "17841400000000001" {
		t.Fatalf("expected account ID 17841400000000001, got %s", snapshot.AccountID)
	}

	var parsed map[string]any
	if err := json.Unmarshal(snapshot.Metrics, &parsed); err != nil {
		t.Fatalf("failed to parse snapshot metrics JSON: %v", err)
	}

	if parsed["account_metrics"] == nil {
		t.Fatalf("expected account_metrics in snapshot")
	}
	if parsed["top_media"] == nil {
		t.Fatalf("expected top_media in snapshot")
	}

	// Verify it was persisted to repo
	persisted, err := repo.GetInsightsSnapshot(ctx, "17841400000000001", today)
	if err != nil {
		t.Fatalf("failed to fetch snapshot from repo: %v", err)
	}
	if string(persisted.Metrics) != string(snapshot.Metrics) {
		t.Fatalf("stored metrics mismatch")
	}
}

func TestSnapshotRunner_TokenError(t *testing.T) {
	ctx := context.Background()
	repo := db.NewMemoryRepository()
	mockClient := &MockClient{}

	tokenProvider := func(ctx context.Context) (string, error) {
		return "", errors.New("no active token")
	}

	runner := NewSnapshotRunner(repo, mockClient, tokenProvider, "17841400000000001")
	_, err := runner.TakeSnapshot(ctx, time.Now().UTC())
	if err == nil {
		t.Fatalf("expected error when token provider fails, got nil")
	}
}

func TestSnapshotRunner_ClientError(t *testing.T) {
	ctx := context.Background()
	repo := db.NewMemoryRepository()
	mockClient := &MockClient{
		AccountMetricsFn: func(ctx context.Context, accountID, accessToken string) (map[string]any, error) {
			return nil, errors.New("graph api 500 internal server error")
		},
	}

	tokenProvider := func(ctx context.Context) (string, error) {
		return "token", nil
	}

	runner := NewSnapshotRunner(repo, mockClient, tokenProvider, "17841400000000001")
	_, err := runner.TakeSnapshot(ctx, time.Now().UTC())
	if err == nil {
		t.Fatalf("expected error when client fails, got nil")
	}
}
