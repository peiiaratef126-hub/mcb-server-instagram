package db

import (
	"time"

	"github.com/google/uuid"
)

// AccessToken represents the encrypted Instagram access token at rest.
type AccessToken struct {
	AccountID        string     `json:"account_id"`
	TokenCiphertext  string     `json:"token_ciphertext"`
	Nonce            string     `json:"nonce"`
	KeyID            string     `json:"key_id"`
	Scopes           []string   `json:"scopes"`
	ExpiresAt        *time.Time `json:"expires_at,omitempty"`
	LastRefreshedAt  time.Time  `json:"last_refreshed_at"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
}

// PublishStatus represents the lifecycle state of a publish job.
type PublishStatus string

const (
	StatusPending    PublishStatus = "pending"
	StatusScheduled  PublishStatus = "scheduled"
	StatusUploading  PublishStatus = "uploading"
	StatusProcessing PublishStatus = "processing"
	StatusPublished  PublishStatus = "published"
	StatusFailed     PublishStatus = "failed"
)

// PublishJob represents a queued publishing task in PostgreSQL.
type PublishJob struct {
	ID               uuid.UUID     `json:"id"`
	IdempotencyKey   string        `json:"idempotency_key"`
	AccountID        string        `json:"account_id"`
	MediaType        string        `json:"media_type"` // IMAGE, VIDEO, REELS, CAROUSEL
	Caption          *string       `json:"caption,omitempty"`
	Payload          []byte        `json:"payload"`
	ContainerID      *string       `json:"container_id,omitempty"`
	PublishedMediaID *string       `json:"published_media_id,omitempty"`
	Status           PublishStatus `json:"status"`
	ScheduledAt      *time.Time    `json:"scheduled_at,omitempty"`
	NextRunAt        time.Time     `json:"next_run_at"`
	Attempts         int           `json:"attempts"`
	MaxAttempts      int           `json:"max_attempts"`
	LastError        *string       `json:"last_error,omitempty"`
	CreatedAt        time.Time     `json:"created_at"`
	UpdatedAt        time.Time     `json:"updated_at"`
}

// DailyQuota represents daily quota counters per account.
type DailyQuota struct {
	AccountID      string    `json:"account_id"`
	QuotaDate      time.Time `json:"quota_date"`
	PublishedPosts int       `json:"published_posts"`
	APICallsMade   int       `json:"api_calls_made"`
	CommentsSent   int       `json:"comments_sent"`
	MessagesSent   int       `json:"messages_sent"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// InsightsSnapshot represents daily account and media insights snapshots.
type InsightsSnapshot struct {
	ID           uuid.UUID `json:"id"`
	AccountID    string    `json:"account_id"`
	SnapshotDate time.Time `json:"snapshot_date"`
	Metrics      []byte    `json:"metrics"`
	CreatedAt    time.Time `json:"created_at"`
}
