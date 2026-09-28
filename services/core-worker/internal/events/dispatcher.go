package events

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/peiiaratef126-hub/mcb-server-instagram/services/core-worker/internal/db"
)

type EventDispatcher struct {
	repo         db.Repository
	handler      EventHandler
	logger       *slog.Logger
	pollInterval time.Duration
}

func NewEventDispatcher(
	repo db.Repository,
	handler EventHandler,
	logger *slog.Logger,
	pollInterval time.Duration,
) *EventDispatcher {
	if logger == nil {
		logger = slog.Default()
	}
	if handler == nil {
		handler = &NoopEventHandler{}
	}
	if pollInterval <= 0 {
		pollInterval = 500 * time.Millisecond
	}
	return &EventDispatcher{
		repo:         repo,
		handler:      handler,
		logger:       logger,
		pollInterval: pollInterval,
	}
}

// ProcessNextBatch claims up to batchSize unprocessed events and dispatches them.
func (d *EventDispatcher) ProcessNextBatch(ctx context.Context, batchSize int) (int, error) {
	events, err := d.repo.ClaimUnprocessedWebhookEvents(ctx, batchSize)
	if err != nil {
		return 0, fmt.Errorf("failed to claim unprocessed webhook events: %w", err)
	}

	processedCount := 0
	for _, rawEvent := range events {
		var dispatchErr error

		accountID := ""
		if rawEvent.EventID != nil {
			accountID = *rawEvent.EventID
		}

		switch rawEvent.Field {
		case "comments":
			dispatchErr = d.processCommentEvent(ctx, rawEvent, accountID)
		case "mentions":
			dispatchErr = d.processMentionEvent(ctx, rawEvent, accountID)
		case "messages":
			dispatchErr = d.processMessageEvent(ctx, rawEvent, accountID)
		default:
			d.logger.Info("Received unhandled or generic webhook event", "field", rawEvent.Field, "id", rawEvent.ID)
		}

		var errMsg *string
		if dispatchErr != nil {
			msg := dispatchErr.Error()
			errMsg = &msg
			d.logger.Error("Failed to process webhook event", "event_id", rawEvent.ID, "field", rawEvent.Field, "error", dispatchErr)
		} else {
			d.logger.Info("Successfully processed webhook event", "event_id", rawEvent.ID, "field", rawEvent.Field)
		}

		if markErr := d.repo.MarkWebhookEventProcessed(ctx, rawEvent.ID, errMsg); markErr != nil {
			d.logger.Error("Failed to mark webhook event processed in db", "event_id", rawEvent.ID, "error", markErr)
		}
		processedCount++
	}

	return processedCount, nil
}

func (d *EventDispatcher) processCommentEvent(ctx context.Context, raw *db.WebhookEvent, accountID string) error {
	var payload struct {
		ID       string          `json:"id"`
		Text     string          `json:"text"`
		From     WebhookUser     `json:"from"`
		Media    WebhookMediaRef `json:"media"`
		ParentID *string         `json:"parent_id,omitempty"`
	}

	if err := json.Unmarshal(raw.Payload, &payload); err != nil {
		return fmt.Errorf("malformed comment payload: %w", err)
	}

	evt := &CommentEvent{
		EventID:   raw.ID,
		AccountID: accountID,
		CommentID: payload.ID,
		Text:      payload.Text,
		From:      payload.From,
		Media:     payload.Media,
		ParentID:  payload.ParentID,
		CreatedAt: raw.CreatedAt,
	}

	return d.handler.HandleComment(ctx, evt)
}

func (d *EventDispatcher) processMentionEvent(ctx context.Context, raw *db.WebhookEvent, accountID string) error {
	var payload struct {
		CommentID *string `json:"comment_id,omitempty"`
		MediaID   *string `json:"media_id,omitempty"`
	}

	if err := json.Unmarshal(raw.Payload, &payload); err != nil {
		return fmt.Errorf("malformed mention payload: %w", err)
	}

	evt := &MentionEvent{
		EventID:   raw.ID,
		AccountID: accountID,
		CommentID: payload.CommentID,
		MediaID:   payload.MediaID,
		CreatedAt: raw.CreatedAt,
	}

	return d.handler.HandleMention(ctx, evt)
}

func (d *EventDispatcher) processMessageEvent(ctx context.Context, raw *db.WebhookEvent, accountID string) error {
	var payload struct {
		Sender struct {
			ID string `json:"id"`
		} `json:"sender"`
		Recipient struct {
			ID string `json:"id"`
		} `json:"recipient"`
		Timestamp int64 `json:"timestamp"`
		Message   struct {
			MID  string `json:"mid"`
			Text string `json:"text"`
		} `json:"message"`
	}

	if err := json.Unmarshal(raw.Payload, &payload); err != nil {
		return fmt.Errorf("malformed messaging payload: %w", err)
	}

	// Use recipient as accountID if not set at top level
	if accountID == "" {
		accountID = payload.Recipient.ID
	}

	evt := &MessageEvent{
		EventID:   raw.ID,
		AccountID: accountID,
		SenderID:  payload.Sender.ID,
		MessageID: payload.Message.MID,
		Text:      payload.Message.Text,
		Timestamp: payload.Timestamp,
		CreatedAt: raw.CreatedAt,
	}

	return d.handler.HandleMessage(ctx, evt)
}

func (d *EventDispatcher) Start(ctx context.Context) {
	ticker := time.NewTicker(d.pollInterval)
	defer ticker.Stop()

	d.logger.Info("Starting webhook event dispatcher loop...")
	for {
		select {
		case <-ctx.Done():
			d.logger.Info("Webhook event dispatcher stopping")
			return
		case <-ticker.C:
			count, err := d.ProcessNextBatch(ctx, 20)
			if err != nil {
				d.logger.Error("Error processing webhook events batch", "error", err)
			} else if count > 0 {
				d.logger.Debug("Processed batch of webhook events", "count", count)
			}
		}
	}
}
