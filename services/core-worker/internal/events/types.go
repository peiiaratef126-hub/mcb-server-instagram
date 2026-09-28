package events

import (
	"context"
	"time"

	"github.com/google/uuid"
)

type WebhookUser struct {
	ID       string `json:"id"`
	Username string `json:"username,omitempty"`
}

type WebhookMediaRef struct {
	ID string `json:"id"`
}

type CommentEvent struct {
	EventID   uuid.UUID       `json:"event_id"`
	AccountID string          `json:"account_id"`
	CommentID string          `json:"comment_id"`
	Text      string          `json:"text"`
	From      WebhookUser     `json:"from"`
	Media     WebhookMediaRef `json:"media"`
	ParentID  *string         `json:"parent_id,omitempty"`
	CreatedAt time.Time       `json:"created_at"`
}

type MentionEvent struct {
	EventID   uuid.UUID `json:"event_id"`
	AccountID string    `json:"account_id"`
	CommentID *string   `json:"comment_id,omitempty"`
	MediaID   *string   `json:"media_id,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

type MessageEvent struct {
	EventID    uuid.UUID   `json:"event_id"`
	AccountID  string      `json:"account_id"`
	SenderID   string      `json:"sender_id"`
	MessageID  string      `json:"message_id"`
	Text       string      `json:"text"`
	Timestamp  int64       `json:"timestamp"`
	CreatedAt  time.Time   `json:"created_at"`
}

type EventHandler interface {
	HandleComment(ctx context.Context, event *CommentEvent) error
	HandleMention(ctx context.Context, event *MentionEvent) error
	HandleMessage(ctx context.Context, event *MessageEvent) error
}

type NoopEventHandler struct{}

func (n *NoopEventHandler) HandleComment(ctx context.Context, event *CommentEvent) error { return nil }
func (n *NoopEventHandler) HandleMention(ctx context.Context, event *MentionEvent) error { return nil }
func (n *NoopEventHandler) HandleMessage(ctx context.Context, event *MessageEvent) error { return nil }
