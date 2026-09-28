package events

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/peiiaratef126-hub/mcb-server-instagram/services/core-worker/internal/db"
)

type mockRecordingHandler struct {
	comments []*CommentEvent
	mentions []*MentionEvent
	messages []*MessageEvent
	errToRet error
}

func (m *mockRecordingHandler) HandleComment(ctx context.Context, event *CommentEvent) error {
	m.comments = append(m.comments, event)
	return m.errToRet
}

func (m *mockRecordingHandler) HandleMention(ctx context.Context, event *MentionEvent) error {
	m.mentions = append(m.mentions, event)
	return m.errToRet
}

func (m *mockRecordingHandler) HandleMessage(ctx context.Context, event *MessageEvent) error {
	m.messages = append(m.messages, event)
	return m.errToRet
}

func TestEventDispatcher_ProcessBatch_Success(t *testing.T) {
	ctx := context.Background()
	repo := db.NewMemoryRepository()
	handler := &mockRecordingHandler{}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	dispatcher := NewEventDispatcher(repo, handler, logger, 10*time.Millisecond)

	// 1. Enqueue comment event
	commentID := uuid.New()
	accountID := "17841400000000001"
	err := repo.SaveWebhookEvent(ctx, &db.WebhookEvent{
		ID:                commentID,
		EventID:           &accountID,
		Field:             "comments",
		Payload:           []byte(`{"id":"17999999999999999","text":"Love this!","from":{"id":"123","username":"tester"},"media":{"id":"456"}}`),
		SignatureVerified: true,
		Processed:         false,
	})
	if err != nil {
		t.Fatalf("failed to save comment event: %v", err)
	}

	// 2. Enqueue mention event
	mentionID := uuid.New()
	err = repo.SaveWebhookEvent(ctx, &db.WebhookEvent{
		ID:                mentionID,
		EventID:           &accountID,
		Field:             "mentions",
		Payload:           []byte(`{"comment_id":"17999999999999998","media_id":"789"}`),
		SignatureVerified: true,
		Processed:         false,
	})
	if err != nil {
		t.Fatalf("failed to save mention event: %v", err)
	}

	// 3. Enqueue messaging event
	messageID := uuid.New()
	err = repo.SaveWebhookEvent(ctx, &db.WebhookEvent{
		ID:                messageID,
		EventID:           &accountID,
		Field:             "messages",
		Payload:           []byte(`{"sender":{"id":"user_abc"},"recipient":{"id":"17841400000000001"},"timestamp":1727524800000,"message":{"mid":"m_999","text":"When are you open?"}}`),
		SignatureVerified: true,
		Processed:         false,
	})
	if err != nil {
		t.Fatalf("failed to save message event: %v", err)
	}

	// Process batch
	count, err := dispatcher.ProcessNextBatch(ctx, 10)
	if err != nil {
		t.Fatalf("failed to process batch: %v", err)
	}
	if count != 3 {
		t.Fatalf("expected 3 processed events, got %d", count)
	}

	// Assert handler received typed events
	if len(handler.comments) != 1 || handler.comments[0].Text != "Love this!" {
		t.Fatalf("comment not handled correctly: %+v", handler.comments)
	}
	if len(handler.mentions) != 1 || *handler.mentions[0].MediaID != "789" {
		t.Fatalf("mention not handled correctly: %+v", handler.mentions)
	}
	if len(handler.messages) != 1 || handler.messages[0].Text != "When are you open?" {
		t.Fatalf("message not handled correctly: %+v", handler.messages)
	}

	// Assert no more unprocessed events in DB
	unprocessed, err := repo.ClaimUnprocessedWebhookEvents(ctx, 10)
	if err != nil {
		t.Fatalf("failed to claim: %v", err)
	}
	if len(unprocessed) != 0 {
		t.Fatalf("expected 0 unprocessed events, got %d", len(unprocessed))
	}
}

func TestEventDispatcher_ProcessBatch_HandlerError(t *testing.T) {
	ctx := context.Background()
	repo := db.NewMemoryRepository()
	handler := &mockRecordingHandler{
		errToRet: errors.New("simulated handler failure"),
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	dispatcher := NewEventDispatcher(repo, handler, logger, 10*time.Millisecond)

	commentID := uuid.New()
	accountID := "17841400000000001"
	err := repo.SaveWebhookEvent(ctx, &db.WebhookEvent{
		ID:                commentID,
		EventID:           &accountID,
		Field:             "comments",
		Payload:           []byte(`{"id":"17999999999999999","text":"Love this!","from":{"id":"123","username":"tester"},"media":{"id":"456"}}`),
		SignatureVerified: true,
		Processed:         false,
	})
	if err != nil {
		t.Fatalf("failed to save event: %v", err)
	}

	count, err := dispatcher.ProcessNextBatch(ctx, 10)
	if err != nil {
		t.Fatalf("ProcessNextBatch failed: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected 1 processed event, got %d", count)
	}

	// Verify event marked processed but with error message
	unprocessed, err := repo.ClaimUnprocessedWebhookEvents(ctx, 10)
	if err != nil {
		t.Fatalf("failed to claim: %v", err)
	}
	if len(unprocessed) != 0 {
		t.Fatalf("expected 0 unprocessed events, got %d", len(unprocessed))
	}
}
