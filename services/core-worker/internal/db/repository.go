package db

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
)

var (
	ErrNotFound       = errors.New("record not found")
	ErrDuplicateKey   = errors.New("duplicate key violation")
	ErrQuotaExceeded  = errors.New("daily quota exceeded")
	ErrInvalidStatus  = errors.New("invalid job status")
)

// Repository defines all database operations for core-worker.
type Repository interface {
	Ping(ctx context.Context) error
	Close() error

	// Access Tokens (Feature 16)
	GetAccessToken(ctx context.Context, accountID string) (*AccessToken, error)
	SaveAccessToken(ctx context.Context, token *AccessToken) error
	UpdateAccessToken(ctx context.Context, token *AccessToken) error
	DeleteAccessToken(ctx context.Context, accountID string) error

	// Publish Queue & State Machine (Features 4, 5, 6, 15)
	EnqueuePublishJob(ctx context.Context, job *PublishJob) (*PublishJob, error)
	ClaimNextPublishJob(ctx context.Context, workerID string) (*PublishJob, error)
	UpdatePublishJob(ctx context.Context, job *PublishJob) error
	GetPublishJob(ctx context.Context, id uuid.UUID) (*PublishJob, error)
	GetPublishJobByIdempotency(ctx context.Context, accountID string, idempotencyKey string) (*PublishJob, error)

	// Atomic Daily Quotas (Feature 18)
	CheckAndIncrementQuota(ctx context.Context, accountID string, quotaDate time.Time, metric string, limit int) (allowed bool, currentCount int, err error)
	GetDailyQuota(ctx context.Context, accountID string, quotaDate time.Time) (*DailyQuota, error)

	// Daily Insights Snapshots (Feature 28)
	SaveInsightsSnapshot(ctx context.Context, snapshot *InsightsSnapshot) error
	GetInsightsSnapshot(ctx context.Context, accountID string, date time.Time) (*InsightsSnapshot, error)
	ListInsightsSnapshots(ctx context.Context, accountID string, limit int) ([]*InsightsSnapshot, error)

	// Webhook Events (Features 20, 21)
	SaveWebhookEvent(ctx context.Context, event *WebhookEvent) error
	ClaimUnprocessedWebhookEvents(ctx context.Context, batchSize int) ([]*WebhookEvent, error)
	MarkWebhookEventProcessed(ctx context.Context, id uuid.UUID, errMsg *string) error

	// Audit Logs (Feature 21)
	SaveAuditLog(ctx context.Context, log *AuditLog) error
	ListAuditLogs(ctx context.Context, accountID string, limit int) ([]*AuditLog, error)
}
