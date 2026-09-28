package quota

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/peiiaratef126-hub/mcb-server-instagram/services/core-worker/internal/db"
)

func TestManager_PublishQuota(t *testing.T) {
	ctx := context.Background()
	repo := db.NewMemoryRepository()
	now := time.Now().UTC()

	mgr := NewManager(repo, Limits{
		MaxPublishedPostsPerDay: 3,
	})

	accountID := "acc_quota_test_01"

	// 1, 2, 3 should succeed
	for i := 1; i <= 3; i++ {
		ok, err := mgr.CheckAndRecordPublish(ctx, accountID, now)
		if err != nil || !ok {
			t.Fatalf("expected post %d to succeed, got ok=%v, err=%v", i, ok, err)
		}
	}

	// 4th should be rejected
	ok, err := mgr.CheckAndRecordPublish(ctx, accountID, now)
	if ok {
		t.Fatalf("expected 4th publish to be rejected, got ok=true")
	}
	if !errors.Is(err, ErrPublishQuotaExceeded) {
		t.Fatalf("expected ErrPublishQuotaExceeded, got %v", err)
	}

	// Another account should still be able to publish
	otherAccount := "acc_quota_test_02"
	ok, err = mgr.CheckAndRecordPublish(ctx, otherAccount, now)
	if err != nil || !ok {
		t.Fatalf("expected other account to succeed, got ok=%v, err=%v", ok, err)
	}

	// Next day rollover should succeed for the original account
	tomorrow := now.Add(24 * time.Hour)
	ok, err = mgr.CheckAndRecordPublish(ctx, accountID, tomorrow)
	if err != nil || !ok {
		t.Fatalf("expected publish on next day to succeed, got ok=%v, err=%v", ok, err)
	}
}

func TestManager_APICallsQuota(t *testing.T) {
	ctx := context.Background()
	repo := db.NewMemoryRepository()
	now := time.Now().UTC()

	mgr := NewManager(repo, Limits{
		MaxAPICallsPerDay: 5,
	})

	accountID := "acc_api_calls_01"

	for i := 1; i <= 5; i++ {
		ok, err := mgr.CheckAndRecordAPICall(ctx, accountID, now)
		if err != nil || !ok {
			t.Fatalf("expected api call %d to succeed, got ok=%v, err=%v", i, ok, err)
		}
	}

	// 6th call exceeds quota
	ok, err := mgr.CheckAndRecordAPICall(ctx, accountID, now)
	if ok {
		t.Fatalf("expected 6th api call to be rejected, got ok=true")
	}
	if !errors.Is(err, ErrAPICallsQuotaExceeded) {
		t.Fatalf("expected ErrAPICallsQuotaExceeded, got %v", err)
	}
}

func TestManager_CommentsAndMessages(t *testing.T) {
	ctx := context.Background()
	repo := db.NewMemoryRepository()
	now := time.Now().UTC()

	mgr := NewManager(repo, Limits{
		MaxCommentsPerDay: 2,
		MaxMessagesPerDay: 2,
	})

	accountID := "acc_cm_01"

	// Comments
	mgr.CheckAndRecordComment(ctx, accountID, now)
	mgr.CheckAndRecordComment(ctx, accountID, now)
	ok, err := mgr.CheckAndRecordComment(ctx, accountID, now)
	if ok || !errors.Is(err, ErrCommentsQuotaExceeded) {
		t.Fatalf("expected comment quota exceeded error, got ok=%v, err=%v", ok, err)
	}

	// Messages
	mgr.CheckAndRecordMessage(ctx, accountID, now)
	mgr.CheckAndRecordMessage(ctx, accountID, now)
	ok, err = mgr.CheckAndRecordMessage(ctx, accountID, now)
	if ok || !errors.Is(err, ErrMessagesQuotaExceeded) {
		t.Fatalf("expected message quota exceeded error, got ok=%v, err=%v", ok, err)
	}

	// Verify usage summary
	usage, err := mgr.GetQuotaUsage(ctx, accountID, now)
	if err != nil {
		t.Fatalf("failed to get usage: %v", err)
	}
	if usage.CommentsSent != 2 || usage.MessagesSent != 2 {
		t.Fatalf("expected 2 comments and 2 messages, got comments=%d, messages=%d", usage.CommentsSent, usage.MessagesSent)
	}
}
