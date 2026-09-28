package autoreply

import (
	"context"
	"io"
	"log/slog"
	"testing"

	"github.com/google/uuid"
	"github.com/peiiaratef126-hub/mcb-server-instagram/services/core-worker/internal/db"
	"github.com/peiiaratef126-hub/mcb-server-instagram/services/core-worker/internal/events"
)

func setupTestEngine(t *testing.T, enabled bool, rules []Rule) (*Engine, *db.MemoryRepository, *MockReplyClient) {
	repo := db.NewMemoryRepository()
	client := NewMockReplyClient()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	engine, err := NewEngine(enabled, rules, repo, client, logger)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}
	return engine, repo, client
}

func TestEngine_DisabledByDefault(t *testing.T) {
	ctx := context.Background()
	rules := []Rule{
		{
			ID:           "rule-comment-shipping",
			Name:         "Shipping FAQ",
			Channel:      ChannelComment,
			MatchType:    MatchKeyword,
			Pattern:      "shipping",
			ResponseText: "We ship worldwide!",
			MaxPerHour:   5,
		},
	}

	// Explicitly DISABLED (default state)
	engine, repo, client := setupTestEngine(t, false, rules)

	commentEvt := &events.CommentEvent{
		EventID:   uuid.New(),
		AccountID: "17841400000000001",
		CommentID: "17900000000000001",
		Text:      "Do you offer free shipping?",
		From:      events.WebhookUser{ID: "user_123", Username: "shopper"},
	}

	if err := engine.HandleComment(ctx, commentEvt); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Assert NO action was taken
	if len(client.CommentReplies) != 0 {
		t.Fatalf("CRITICAL SECURITY VIOLATION: Auto-reply was dispatched while engine was DISABLED! Got %d replies", len(client.CommentReplies))
	}

	// Assert NO audit log written
	logs, _ := repo.ListAuditLogs(ctx, "17841400000000001", 10)
	if len(logs) != 0 {
		t.Fatalf("expected 0 audit logs, got %d", len(logs))
	}
}

func TestEngine_KeywordMatchAndAuditLog(t *testing.T) {
	ctx := context.Background()
	rules := []Rule{
		{
			ID:           "rule-comment-hours",
			Name:         "Store Hours",
			Channel:      ChannelComment,
			MatchType:    MatchKeyword,
			Pattern:      "hours",
			ResponseText: "Our showroom is open Mon-Fri 9am-6pm.",
			MaxPerHour:   5,
		},
	}

	engine, repo, client := setupTestEngine(t, true, rules)

	commentEvt := &events.CommentEvent{
		EventID:   uuid.New(),
		AccountID: "17841400000000001",
		CommentID: "17900000000000002",
		Text:      "What are your opening hours today?",
		From:      events.WebhookUser{ID: "user_456", Username: "visitor"},
	}

	if err := engine.HandleComment(ctx, commentEvt); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Assert reply was dispatched
	if len(client.CommentReplies) != 1 {
		t.Fatalf("expected 1 comment reply, got %d", len(client.CommentReplies))
	}
	if client.CommentReplies[0].CommentID != "17900000000000002" {
		t.Fatalf("expected reply to target comment 17900000000000002, got %s", client.CommentReplies[0].CommentID)
	}
	if client.CommentReplies[0].Text != "Our showroom is open Mon-Fri 9am-6pm." {
		t.Fatalf("expected configured response text, got %s", client.CommentReplies[0].Text)
	}

	// Assert audit log was recorded
	logs, err := repo.ListAuditLogs(ctx, "17841400000000001", 10)
	if err != nil {
		t.Fatalf("failed to list audit logs: %v", err)
	}
	if len(logs) != 1 {
		t.Fatalf("expected 1 audit log entry, got %d", len(logs))
	}
	if logs[0].ActionType != "AUTO_REPLY_COMMENT" || *logs[0].RuleID != "rule-comment-hours" {
		t.Fatalf("audit log invalid: %+v", logs[0])
	}
}

func TestEngine_RegexMatchOnDM(t *testing.T) {
	ctx := context.Background()
	rules := []Rule{
		{
			ID:           "rule-dm-pricing",
			Name:         "Pricing Inquiries",
			Channel:      ChannelDM,
			MatchType:    MatchRegex,
			Pattern:      `(?i)\b(price|pricing|how much|cost)\b`,
			ResponseText: "Pricing starts at $99/mo. Check our site for plans!",
			MaxPerHour:   3,
		},
	}

	engine, repo, client := setupTestEngine(t, true, rules)

	dmEvt := &events.MessageEvent{
		EventID:   uuid.New(),
		AccountID: "17841400000000001",
		SenderID:  "sender_999",
		MessageID: "m_123",
		Text:      "Hi! How much does the enterprise tier cost?",
	}

	if err := engine.HandleMessage(ctx, dmEvt); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(client.DMSent) != 1 {
		t.Fatalf("expected 1 DM sent, got %d", len(client.DMSent))
	}
	if client.DMSent[0].RecipientID != "sender_999" {
		t.Fatalf("expected recipient sender_999, got %s", client.DMSent[0].RecipientID)
	}

	logs, _ := repo.ListAuditLogs(ctx, "17841400000000001", 10)
	if len(logs) != 1 || logs[0].ActionType != "AUTO_REPLY_DM" {
		t.Fatalf("expected 1 DM audit log, got %+v", logs)
	}
}

// CRITICAL TEST: Per-user rate capping prevents spam/loops
func TestEngine_PerUserRateCapping(t *testing.T) {
	ctx := context.Background()
	rules := []Rule{
		{
			ID:           "rule-rate-limited",
			Name:         "Limited Rule",
			Channel:      ChannelComment,
			MatchType:    MatchKeyword,
			Pattern:      "help",
			ResponseText: "Support is available at support@example.com",
			MaxPerHour:   2, // Strict limit: max 2 replies/hour per user
		},
	}

	engine, _, client := setupTestEngine(t, true, rules)

	sendHelp := func(userID string) {
		_ = engine.HandleComment(ctx, &events.CommentEvent{
			EventID:   uuid.New(),
			AccountID: "17841400000000001",
			CommentID: uuid.New().String(),
			Text:      "I need help with setup!",
			From:      events.WebhookUser{ID: userID},
		})
	}

	// User A sends 4 comments in a row
	sendHelp("user_A") // 1 (allowed)
	sendHelp("user_A") // 2 (allowed)
	sendHelp("user_A") // 3 (BLOCKED by rate limit)
	sendHelp("user_A") // 4 (BLOCKED by rate limit)

	// User B sends 1 comment
	sendHelp("user_B") // 1 (allowed)

	// Total replies sent must be 2 for user_A + 1 for user_B = 3
	if len(client.CommentReplies) != 3 {
		t.Fatalf("CRITICAL RATE LIMIT FAILURE: Expected exactly 3 replies sent, got %d", len(client.CommentReplies))
	}
}
