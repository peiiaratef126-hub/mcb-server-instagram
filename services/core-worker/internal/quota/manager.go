package quota

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/peiiaratef126-hub/mcb-server-instagram/services/core-worker/internal/db"
)

var (
	ErrPublishQuotaExceeded   = errors.New("daily publishing quota exceeded (max 25 posts per 24 hours)")
	ErrAPICallsQuotaExceeded  = errors.New("daily api calls quota exceeded")
	ErrCommentsQuotaExceeded  = errors.New("daily comments quota exceeded")
	ErrMessagesQuotaExceeded  = errors.New("daily messages quota exceeded")
	ErrInvalidQuotaMetric     = errors.New("invalid quota metric")
)

// Limits defines configurable daily thresholds per Instagram account.
type Limits struct {
	// Meta Content Publishing API imposes a hard limit of 25 API-published posts per 24 hours.
	MaxPublishedPostsPerDay int
	MaxAPICallsPerDay       int
	MaxCommentsPerDay       int
	MaxMessagesPerDay       int
}

// DefaultLimits returns official Meta recommended daily safety limits.
func DefaultLimits() Limits {
	return Limits{
		MaxPublishedPostsPerDay: 25,
		MaxAPICallsPerDay:       4800,
		MaxCommentsPerDay:       500,
		MaxMessagesPerDay:       1000,
	}
}

// Manager coordinates atomic rate limits and quota tracking across operations.
type Manager struct {
	repo   db.Repository
	limits Limits
}

// NewManager creates a quota manager with specified or default limits.
func NewManager(repo db.Repository, limits Limits) *Manager {
	if limits.MaxPublishedPostsPerDay <= 0 {
		limits.MaxPublishedPostsPerDay = 25
	}
	if limits.MaxAPICallsPerDay <= 0 {
		limits.MaxAPICallsPerDay = 4800
	}
	if limits.MaxCommentsPerDay <= 0 {
		limits.MaxCommentsPerDay = 500
	}
	if limits.MaxMessagesPerDay <= 0 {
		limits.MaxMessagesPerDay = 1000
	}
	return &Manager{
		repo:   repo,
		limits: limits,
	}
}

// CheckAndRecordPublish atomically checks if account can publish another post today and increments counter.
func (m *Manager) CheckAndRecordPublish(ctx context.Context, accountID string, now time.Time) (bool, error) {
	allowed, current, err := m.repo.CheckAndIncrementQuota(ctx, accountID, now, "posts", m.limits.MaxPublishedPostsPerDay)
	if err != nil {
		return false, fmt.Errorf("failed to check publishing quota: %w", err)
	}
	if !allowed {
		return false, fmt.Errorf("%w: current usage is %d/%d", ErrPublishQuotaExceeded, current, m.limits.MaxPublishedPostsPerDay)
	}
	return true, nil
}

// CheckAndRecordAPICall atomically records an API call under the daily budget.
func (m *Manager) CheckAndRecordAPICall(ctx context.Context, accountID string, now time.Time) (bool, error) {
	allowed, current, err := m.repo.CheckAndIncrementQuota(ctx, accountID, now, "api_calls", m.limits.MaxAPICallsPerDay)
	if err != nil {
		return false, fmt.Errorf("failed to check api calls quota: %w", err)
	}
	if !allowed {
		return false, fmt.Errorf("%w: current usage is %d/%d", ErrAPICallsQuotaExceeded, current, m.limits.MaxAPICallsPerDay)
	}
	return true, nil
}

// CheckAndRecordComment atomically records an outbound comment under the daily budget.
func (m *Manager) CheckAndRecordComment(ctx context.Context, accountID string, now time.Time) (bool, error) {
	allowed, current, err := m.repo.CheckAndIncrementQuota(ctx, accountID, now, "comments", m.limits.MaxCommentsPerDay)
	if err != nil {
		return false, fmt.Errorf("failed to check comments quota: %w", err)
	}
	if !allowed {
		return false, fmt.Errorf("%w: current usage is %d/%d", ErrCommentsQuotaExceeded, current, m.limits.MaxCommentsPerDay)
	}
	return true, nil
}

// CheckAndRecordMessage atomically records a direct message under the daily budget.
func (m *Manager) CheckAndRecordMessage(ctx context.Context, accountID string, now time.Time) (bool, error) {
	allowed, current, err := m.repo.CheckAndIncrementQuota(ctx, accountID, now, "messages", m.limits.MaxMessagesPerDay)
	if err != nil {
		return false, fmt.Errorf("failed to check messages quota: %w", err)
	}
	if !allowed {
		return false, fmt.Errorf("%w: current usage is %d/%d", ErrMessagesQuotaExceeded, current, m.limits.MaxMessagesPerDay)
	}
	return true, nil
}

// GetQuotaUsage retrieves current quota usage stats for today.
func (m *Manager) GetQuotaUsage(ctx context.Context, accountID string, now time.Time) (*db.DailyQuota, error) {
	return m.repo.GetDailyQuota(ctx, accountID, now)
}
