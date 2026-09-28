package autoreply

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/peiiaratef126-hub/mcb-server-instagram/services/core-worker/internal/db"
	"github.com/peiiaratef126-hub/mcb-server-instagram/services/core-worker/internal/events"
)

var (
	ErrAutoReplyDisabled = errors.New("auto-reply is disabled by configuration")
	ErrRateLimitExceeded = errors.New("user rate limit exceeded for auto-reply rule")
)

type MatchType string

const (
	MatchKeyword MatchType = "keyword"
	MatchRegex   MatchType = "regex"
)

type Channel string

const (
	ChannelComment Channel = "comment"
	ChannelDM      Channel = "dm"
)

type Rule struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	Channel      Channel   `json:"channel"`
	MatchType    MatchType `json:"match_type"`
	Pattern      string    `json:"pattern"`
	ResponseText string    `json:"response_text"`
	MaxPerHour   int       `json:"max_per_hour"` // Default e.g. 5 replies/hour per user

	compiledRegex *regexp.Regexp
}

func (r *Rule) Compile() error {
	if r.MatchType == MatchRegex {
		compiled, err := regexp.Compile(r.Pattern)
		if err != nil {
			return fmt.Errorf("invalid regex pattern '%s': %w", r.Pattern, err)
		}
		r.compiledRegex = compiled
	}
	if r.MaxPerHour <= 0 {
		r.MaxPerHour = 5
	}
	return nil
}

func (r *Rule) Matches(text string) bool {
	switch r.MatchType {
	case MatchKeyword:
		return strings.Contains(strings.ToLower(text), strings.ToLower(r.Pattern))
	case MatchRegex:
		if r.compiledRegex != nil {
			return r.compiledRegex.MatchString(text)
		}
		return false
	default:
		return false
	}
}

type ReplyClient interface {
	ReplyToComment(ctx context.Context, commentID, text string) (string, error)
	SendDirectMessage(ctx context.Context, recipientID, text string) (string, error)
}

type MockReplyClient struct {
	mu           sync.Mutex
	CommentReplies []struct{ CommentID, Text string }
	DMSent         []struct{ RecipientID, Text string }
}

func NewMockReplyClient() *MockReplyClient {
	return &MockReplyClient{}
}

func (m *MockReplyClient) ReplyToComment(ctx context.Context, commentID, text string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.CommentReplies = append(m.CommentReplies, struct{ CommentID, Text string }{commentID, text})
	return "reply_" + uuid.New().String(), nil
}

func (m *MockReplyClient) SendDirectMessage(ctx context.Context, recipientID, text string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.DMSent = append(m.DMSent, struct{ RecipientID, Text string }{recipientID, text})
	return "mid_" + uuid.New().String(), nil
}

type Engine struct {
	enabled bool
	rules   []Rule
	repo    db.Repository
	client  ReplyClient
	logger  *slog.Logger

	rateMu      sync.Mutex
	userHistory map[string][]time.Time // key: ruleID + ":" + userID
}

func NewEngine(
	enabled bool,
	rules []Rule,
	repo db.Repository,
	client ReplyClient,
	logger *slog.Logger,
) (*Engine, error) {
	if logger == nil {
		logger = slog.Default()
	}

	compiledRules := make([]Rule, len(rules))
	for i, r := range rules {
		ruleCopy := r
		if err := ruleCopy.Compile(); err != nil {
			return nil, err
		}
		compiledRules[i] = ruleCopy
	}

	return &Engine{
		enabled:     enabled,
		rules:       compiledRules,
		repo:        repo,
		client:      client,
		logger:      logger,
		userHistory: make(map[string][]time.Time),
	}, nil
}

func (e *Engine) IsEnabled() bool {
	return e.enabled
}

func (e *Engine) checkAndRecordRate(ruleID, userID string, maxPerHour int, now time.Time) bool {
	e.rateMu.Lock()
	defer e.rateMu.Unlock()

	key := ruleID + ":" + userID
	history := e.userHistory[key]

	cutoff := now.Add(-1 * time.Hour)
	valid := make([]time.Time, 0, len(history))
	for _, t := range history {
		if t.After(cutoff) {
			valid = append(valid, t)
		}
	}

	if len(valid) >= maxPerHour {
		e.userHistory[key] = valid
		return false
	}

	valid = append(valid, now)
	e.userHistory[key] = valid
	return true
}

func (e *Engine) HandleComment(ctx context.Context, event *events.CommentEvent) error {
	if !e.enabled {
		e.logger.Debug("Auto-reply skipped: AUTO_REPLY_ENABLED=false")
		return nil
	}

	for _, rule := range e.rules {
		if rule.Channel != ChannelComment {
			continue
		}

		if rule.Matches(event.Text) {
			userID := event.From.ID
			now := time.Now().UTC()

			if !e.checkAndRecordRate(rule.ID, userID, rule.MaxPerHour, now) {
				e.logger.Warn("Auto-reply rate limit exceeded for user", "rule_id", rule.ID, "user_id", userID)
				continue
			}

			e.logger.Info("Executing auto-reply on comment", "rule_id", rule.ID, "comment_id", event.CommentID)
			replyID, err := e.client.ReplyToComment(ctx, event.CommentID, rule.ResponseText)
			if err != nil {
				e.logger.Error("Failed to dispatch auto-reply comment", "error", err)
				return err
			}

			// Write immutable audit log
			auditDetails, _ := json.Marshal(map[string]interface{}{
				"incoming_text": event.Text,
				"response_text": rule.ResponseText,
				"reply_id":      replyID,
				"from_username": event.From.Username,
			})
			ruleID := rule.ID
			targetID := event.CommentID
			_ = e.repo.SaveAuditLog(ctx, &db.AuditLog{
				ID:         uuid.New(),
				AccountID:  event.AccountID,
				ActionType: "AUTO_REPLY_COMMENT",
				TargetID:   &targetID,
				RuleID:     &ruleID,
				Details:    auditDetails,
				CreatedAt:  now,
			})

			// Only trigger first matching rule
			return nil
		}
	}

	return nil
}

func (e *Engine) HandleMessage(ctx context.Context, event *events.MessageEvent) error {
	if !e.enabled {
		e.logger.Debug("Auto-reply skipped: AUTO_REPLY_ENABLED=false")
		return nil
	}

	for _, rule := range e.rules {
		if rule.Channel != ChannelDM {
			continue
		}

		if rule.Matches(event.Text) {
			userID := event.SenderID
			now := time.Now().UTC()

			if !e.checkAndRecordRate(rule.ID, userID, rule.MaxPerHour, now) {
				e.logger.Warn("Auto-reply rate limit exceeded for DM user", "rule_id", rule.ID, "user_id", userID)
				continue
			}

			e.logger.Info("Executing auto-reply on DM", "rule_id", rule.ID, "sender_id", event.SenderID)
			msgID, err := e.client.SendDirectMessage(ctx, event.SenderID, rule.ResponseText)
			if err != nil {
				e.logger.Error("Failed to dispatch auto-reply DM", "error", err)
				return err
			}

			// Write immutable audit log
			auditDetails, _ := json.Marshal(map[string]interface{}{
				"incoming_text": event.Text,
				"response_text": rule.ResponseText,
				"message_id":    msgID,
			})
			ruleID := rule.ID
			targetID := event.SenderID
			_ = e.repo.SaveAuditLog(ctx, &db.AuditLog{
				ID:         uuid.New(),
				AccountID:  event.AccountID,
				ActionType: "AUTO_REPLY_DM",
				TargetID:   &targetID,
				RuleID:     &ruleID,
				Details:    auditDetails,
				CreatedAt:  now,
			})

			return nil
		}
	}

	return nil
}

func (e *Engine) HandleMention(ctx context.Context, event *events.MentionEvent) error {
	// Mentions do not trigger auto-replies by policy to prevent mention loops
	return nil
}
