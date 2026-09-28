package db

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestMemoryRepository_AccessToken(t *testing.T) {
	ctx := context.Background()
	repo := NewMemoryRepository()

	// Initial get returns not found
	_, err := repo.GetAccessToken(ctx, "acc_123")
	if err != ErrNotFound {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}

	// Save token
	expires := time.Now().UTC().Add(60 * 24 * time.Hour)
	token := &AccessToken{
		AccountID:       "acc_123",
		TokenCiphertext: "ciphertext-12345",
		Nonce:           "nonce-12345",
		KeyID:           "v1",
		Scopes:          []string{"instagram_basic", "instagram_manage_comments"},
		ExpiresAt:       &expires,
	}

	if err := repo.SaveAccessToken(ctx, token); err != nil {
		t.Fatalf("failed to save token: %v", err)
	}

	// Get token
	saved, err := repo.GetAccessToken(ctx, "acc_123")
	if err != nil {
		t.Fatalf("failed to get token: %v", err)
	}
	if saved.TokenCiphertext != "ciphertext-12345" {
		t.Fatalf("expected ciphertext-12345, got %s", saved.TokenCiphertext)
	}
	if len(saved.Scopes) != 2 {
		t.Fatalf("expected 2 scopes, got %d", len(saved.Scopes))
	}

	// Delete token
	if err := repo.DeleteAccessToken(ctx, "acc_123"); err != nil {
		t.Fatalf("failed to delete token: %v", err)
	}
	_, err = repo.GetAccessToken(ctx, "acc_123")
	if err != ErrNotFound {
		t.Fatalf("expected ErrNotFound after delete, got %v", err)
	}
}

func TestMemoryRepository_PublishQueue(t *testing.T) {
	ctx := context.Background()
	repo := NewMemoryRepository()

	job := &PublishJob{
		IdempotencyKey: "idem_key_001",
		AccountID:      "acc_123",
		MediaType:      "IMAGE",
		Payload:        []byte(`{"image_url":"https://example.com/test.jpg"}`),
	}

	enqueued, err := repo.EnqueuePublishJob(ctx, job)
	if err != nil {
		t.Fatalf("failed to enqueue: %v", err)
	}
	if enqueued.ID == uuid.Nil {
		t.Fatalf("expected non-nil job ID")
	}
	if enqueued.Status != StatusPending {
		t.Fatalf("expected status pending, got %s", enqueued.Status)
	}

	// Duplicate idempotency key rejection
	_, err = repo.EnqueuePublishJob(ctx, &PublishJob{
		IdempotencyKey: "idem_key_001",
		AccountID:      "acc_123",
		MediaType:      "IMAGE",
		Payload:        []byte(`{}`),
	})
	if err != ErrDuplicateKey {
		t.Fatalf("expected ErrDuplicateKey, got %v", err)
	}

	// Claim next job
	claimed, err := repo.ClaimNextPublishJob(ctx, "worker-1")
	if err != nil {
		t.Fatalf("failed to claim job: %v", err)
	}
	if claimed == nil {
		t.Fatalf("expected job to be claimed, got nil")
	}
	if claimed.Status != StatusProcessing {
		t.Fatalf("expected claimed job status processing, got %s", claimed.Status)
	}
	if claimed.Attempts != 1 {
		t.Fatalf("expected attempts 1, got %d", claimed.Attempts)
	}

	// Next claim should yield nil (already claimed/processing)
	secondClaim, err := repo.ClaimNextPublishJob(ctx, "worker-2")
	if err != nil {
		t.Fatalf("unexpected error claiming second time: %v", err)
	}
	if secondClaim != nil {
		t.Fatalf("expected nil when no pending jobs available, got %v", secondClaim)
	}

	// Update job to published
	publishedID := "ig_media_999888"
	claimed.Status = StatusPublished
	claimed.PublishedMediaID = &publishedID
	if err := repo.UpdatePublishJob(ctx, claimed); err != nil {
		t.Fatalf("failed to update job: %v", err)
	}

	fetched, err := repo.GetPublishJob(ctx, claimed.ID)
	if err != nil {
		t.Fatalf("failed to get job: %v", err)
	}
	if fetched.Status != StatusPublished {
		t.Fatalf("expected status published, got %s", fetched.Status)
	}
}

func TestMemoryRepository_DailyQuota(t *testing.T) {
	ctx := context.Background()
	repo := NewMemoryRepository()
	today := time.Now().UTC()

	// Check limit 3
	for i := 1; i <= 3; i++ {
		allowed, count, err := repo.CheckAndIncrementQuota(ctx, "acc_123", today, "posts", 3)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !allowed {
			t.Fatalf("expected allowed=true on iteration %d", i)
		}
		if count != i {
			t.Fatalf("expected count=%d, got %d", i, count)
		}
	}

	// 4th attempt should exceed limit
	allowed, count, err := repo.CheckAndIncrementQuota(ctx, "acc_123", today, "posts", 3)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if allowed {
		t.Fatalf("expected allowed=false when limit reached")
	}
	if count != 3 {
		t.Fatalf("expected count to stay at limit 3, got %d", count)
	}
}

func TestMemoryRepository_InsightsSnapshot(t *testing.T) {
	ctx := context.Background()
	repo := NewMemoryRepository()
	today := time.Now().UTC()

	snapshot := &InsightsSnapshot{
		AccountID:    "acc_123",
		SnapshotDate: today,
		Metrics:      []byte(`{"followers_count":1250,"reach":5000}`),
	}

	if err := repo.SaveInsightsSnapshot(ctx, snapshot); err != nil {
		t.Fatalf("failed to save snapshot: %v", err)
	}

	fetched, err := repo.GetInsightsSnapshot(ctx, "acc_123", today)
	if err != nil {
		t.Fatalf("failed to fetch snapshot: %v", err)
	}
	if string(fetched.Metrics) != string(snapshot.Metrics) {
		t.Fatalf("metrics mismatch: %s vs %s", string(fetched.Metrics), string(snapshot.Metrics))
	}

	list, err := repo.ListInsightsSnapshots(ctx, "acc_123", 10)
	if err != nil {
		t.Fatalf("failed to list snapshots: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("expected 1 snapshot, got %d", len(list))
	}
}
