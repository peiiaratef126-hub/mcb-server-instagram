package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
)

// PostgresRepository implements Repository backed by a PostgreSQL database.
type PostgresRepository struct {
	db *sql.DB
}

// NewPostgresRepository constructs a new PostgresRepository.
func NewPostgresRepository(db *sql.DB) *PostgresRepository {
	return &PostgresRepository{db: db}
}

func (r *PostgresRepository) Ping(ctx context.Context) error {
	return r.db.PingContext(ctx)
}

func (r *PostgresRepository) Close() error {
	return r.db.Close()
}

// --- Access Tokens (Feature 16) ---

func (r *PostgresRepository) GetAccessToken(ctx context.Context, accountID string) (*AccessToken, error) {
	query := `
		SELECT account_id, token_ciphertext, nonce, key_id, scopes, expires_at, last_refreshed_at, created_at, updated_at
		FROM access_tokens
		WHERE account_id = $1
	`
	var t AccessToken
	var scopes pq.StringArray
	var expiresAt sql.NullTime

	err := r.db.QueryRowContext(ctx, query, accountID).Scan(
		&t.AccountID,
		&t.TokenCiphertext,
		&t.Nonce,
		&t.KeyID,
		&scopes,
		&expiresAt,
		&t.LastRefreshedAt,
		&t.CreatedAt,
		&t.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("failed to get access token: %w", err)
	}

	t.Scopes = []string(scopes)
	if expiresAt.Valid {
		t.ExpiresAt = &expiresAt.Time
	}

	return &t, nil
}

func (r *PostgresRepository) SaveAccessToken(ctx context.Context, token *AccessToken) error {
	query := `
		INSERT INTO access_tokens (
			account_id, token_ciphertext, nonce, key_id, scopes, expires_at, last_refreshed_at, created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (account_id) DO UPDATE SET
			token_ciphertext = EXCLUDED.token_ciphertext,
			nonce = EXCLUDED.nonce,
			key_id = EXCLUDED.key_id,
			scopes = EXCLUDED.scopes,
			expires_at = EXCLUDED.expires_at,
			last_refreshed_at = EXCLUDED.last_refreshed_at,
			updated_at = NOW()
	`
	now := time.Now().UTC()
	createdAt := token.CreatedAt
	if createdAt.IsZero() {
		createdAt = now
	}
	updatedAt := token.UpdatedAt
	if updatedAt.IsZero() {
		updatedAt = now
	}
	lastRefreshedAt := token.LastRefreshedAt
	if lastRefreshedAt.IsZero() {
		lastRefreshedAt = now
	}

	_, err := r.db.ExecContext(ctx, query,
		token.AccountID,
		token.TokenCiphertext,
		token.Nonce,
		token.KeyID,
		pq.Array(token.Scopes),
		token.ExpiresAt,
		lastRefreshedAt,
		createdAt,
		updatedAt,
	)
	if err != nil {
		return fmt.Errorf("failed to save access token: %w", err)
	}
	return nil
}

func (r *PostgresRepository) UpdateAccessToken(ctx context.Context, token *AccessToken) error {
	return r.SaveAccessToken(ctx, token)
}

func (r *PostgresRepository) DeleteAccessToken(ctx context.Context, accountID string) error {
	query := `DELETE FROM access_tokens WHERE account_id = $1`
	res, err := r.db.ExecContext(ctx, query, accountID)
	if err != nil {
		return fmt.Errorf("failed to delete access token: %w", err)
	}
	rows, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return ErrNotFound
	}
	return nil
}

// --- Publish Queue & State Machine (Features 4, 5, 6, 15) ---

func (r *PostgresRepository) EnqueuePublishJob(ctx context.Context, job *PublishJob) (*PublishJob, error) {
	query := `
		INSERT INTO publish_queue (
			idempotency_key, account_id, media_type, caption, payload,
			container_id, published_media_id, status, scheduled_at,
			next_run_at, attempts, max_attempts, last_error, created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
		RETURNING id, created_at, updated_at
	`
	if job.Status == "" {
		job.Status = StatusPending
	}
	if job.MaxAttempts <= 0 {
		job.MaxAttempts = 5
	}
	if job.NextRunAt.IsZero() {
		job.NextRunAt = time.Now().UTC()
	}

	err := r.db.QueryRowContext(ctx, query,
		job.IdempotencyKey,
		job.AccountID,
		job.MediaType,
		job.Caption,
		job.Payload,
		job.ContainerID,
		job.PublishedMediaID,
		job.Status,
		job.ScheduledAt,
		job.NextRunAt,
		job.Attempts,
		job.MaxAttempts,
		job.LastError,
	).Scan(&job.ID, &job.CreatedAt, &job.UpdatedAt)
	if err != nil {
		var pqErr *pq.Error
		if errors.As(err, &pqErr) && pqErr.Code == "23505" { // unique_violation
			return nil, ErrDuplicateKey
		}
		return nil, fmt.Errorf("failed to enqueue publish job: %w", err)
	}

	return job, nil
}

func (r *PostgresRepository) ClaimNextPublishJob(ctx context.Context, workerID string) (*PublishJob, error) {
	tx, err := r.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return nil, fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	selectQuery := `
		SELECT id, idempotency_key, account_id, media_type, caption, payload,
		       container_id, published_media_id, status, scheduled_at, next_run_at,
		       attempts, max_attempts, last_error, created_at, updated_at
		FROM publish_queue
		WHERE status IN ('pending', 'scheduled', 'uploading', 'processing')
		  AND next_run_at <= NOW()
		ORDER BY next_run_at ASC
		LIMIT 1
		FOR UPDATE SKIP LOCKED
	`

	var job PublishJob
	var caption, containerID, publishedMediaID, lastError sql.NullString
	var scheduledAt sql.NullTime

	err = tx.QueryRowContext(ctx, selectQuery).Scan(
		&job.ID,
		&job.IdempotencyKey,
		&job.AccountID,
		&job.MediaType,
		&caption,
		&job.Payload,
		&containerID,
		&publishedMediaID,
		&job.Status,
		&scheduledAt,
		&job.NextRunAt,
		&job.Attempts,
		&job.MaxAttempts,
		&lastError,
		&job.CreatedAt,
		&job.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil // No jobs ready to claim
		}
		return nil, fmt.Errorf("failed to query next publish job: %w", err)
	}

	if caption.Valid {
		job.Caption = &caption.String
	}
	if containerID.Valid {
		job.ContainerID = &containerID.String
	}
	if publishedMediaID.Valid {
		job.PublishedMediaID = &publishedMediaID.String
	}
	if lastError.Valid {
		job.LastError = &lastError.String
	}
	if scheduledAt.Valid {
		job.ScheduledAt = &scheduledAt.Time
	}

	// Transition status to processing and increment attempts atomically
	updateQuery := `
		UPDATE publish_queue
		SET status = 'processing',
		    attempts = attempts + 1,
		    updated_at = NOW()
		WHERE id = $1
		RETURNING attempts, updated_at
	`
	err = tx.QueryRowContext(ctx, updateQuery, job.ID).Scan(&job.Attempts, &job.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("failed to update claimed publish job: %w", err)
	}
	job.Status = StatusProcessing

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("failed to commit job claim: %w", err)
	}

	return &job, nil
}

func (r *PostgresRepository) UpdatePublishJob(ctx context.Context, job *PublishJob) error {
	query := `
		UPDATE publish_queue
		SET status = $1,
		    container_id = $2,
		    published_media_id = $3,
		    next_run_at = $4,
		    attempts = $5,
		    last_error = $6,
		    updated_at = NOW()
		WHERE id = $7
		RETURNING updated_at
	`
	err := r.db.QueryRowContext(ctx, query,
		job.Status,
		job.ContainerID,
		job.PublishedMediaID,
		job.NextRunAt,
		job.Attempts,
		job.LastError,
		job.ID,
	).Scan(&job.UpdatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return fmt.Errorf("failed to update publish job: %w", err)
	}
	return nil
}

func (r *PostgresRepository) GetPublishJob(ctx context.Context, id uuid.UUID) (*PublishJob, error) {
	query := `
		SELECT id, idempotency_key, account_id, media_type, caption, payload,
		       container_id, published_media_id, status, scheduled_at, next_run_at,
		       attempts, max_attempts, last_error, created_at, updated_at
		FROM publish_queue
		WHERE id = $1
	`
	var job PublishJob
	var caption, containerID, publishedMediaID, lastError sql.NullString
	var scheduledAt sql.NullTime

	err := r.db.QueryRowContext(ctx, query, id).Scan(
		&job.ID,
		&job.IdempotencyKey,
		&job.AccountID,
		&job.MediaType,
		&caption,
		&job.Payload,
		&containerID,
		&publishedMediaID,
		&job.Status,
		&scheduledAt,
		&job.NextRunAt,
		&job.Attempts,
		&job.MaxAttempts,
		&lastError,
		&job.CreatedAt,
		&job.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("failed to get publish job: %w", err)
	}

	if caption.Valid {
		job.Caption = &caption.String
	}
	if containerID.Valid {
		job.ContainerID = &containerID.String
	}
	if publishedMediaID.Valid {
		job.PublishedMediaID = &publishedMediaID.String
	}
	if lastError.Valid {
		job.LastError = &lastError.String
	}
	if scheduledAt.Valid {
		job.ScheduledAt = &scheduledAt.Time
	}

	return &job, nil
}

func (r *PostgresRepository) GetPublishJobByIdempotency(ctx context.Context, accountID string, idempotencyKey string) (*PublishJob, error) {
	query := `
		SELECT id, idempotency_key, account_id, media_type, caption, payload,
		       container_id, published_media_id, status, scheduled_at, next_run_at,
		       attempts, max_attempts, last_error, created_at, updated_at
		FROM publish_queue
		WHERE account_id = $1 AND idempotency_key = $2
	`
	var job PublishJob
	var caption, containerID, publishedMediaID, lastError sql.NullString
	var scheduledAt sql.NullTime

	err := r.db.QueryRowContext(ctx, query, accountID, idempotencyKey).Scan(
		&job.ID,
		&job.IdempotencyKey,
		&job.AccountID,
		&job.MediaType,
		&caption,
		&job.Payload,
		&containerID,
		&publishedMediaID,
		&job.Status,
		&scheduledAt,
		&job.NextRunAt,
		&job.Attempts,
		&job.MaxAttempts,
		&lastError,
		&job.CreatedAt,
		&job.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("failed to get publish job by idempotency: %w", err)
	}

	if caption.Valid {
		job.Caption = &caption.String
	}
	if containerID.Valid {
		job.ContainerID = &containerID.String
	}
	if publishedMediaID.Valid {
		job.PublishedMediaID = &publishedMediaID.String
	}
	if lastError.Valid {
		job.LastError = &lastError.String
	}
	if scheduledAt.Valid {
		job.ScheduledAt = &scheduledAt.Time
	}

	return &job, nil
}

// --- Atomic Daily Quotas (Feature 18) ---

func (r *PostgresRepository) CheckAndIncrementQuota(ctx context.Context, accountID string, quotaDate time.Time, metric string, limit int) (bool, int, error) {
	truncDate := time.Date(quotaDate.Year(), quotaDate.Month(), quotaDate.Day(), 0, 0, 0, 0, time.UTC)

	tx, err := r.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return false, 0, fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	selectQuery := `
		SELECT published_posts, api_calls_made, comments_sent, messages_sent
		FROM daily_quotas
		WHERE account_id = $1 AND quota_date = $2
		FOR UPDATE
	`

	var posts, apiCalls, comments, messages int
	err = tx.QueryRowContext(ctx, selectQuery, accountID, truncDate).Scan(&posts, &apiCalls, &comments, &messages)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			if limit <= 0 {
				return false, 0, nil
			}
			insertQuery := `
				INSERT INTO daily_quotas (
					account_id, quota_date, published_posts, api_calls_made, comments_sent, messages_sent, created_at, updated_at
				) VALUES (
					$1, $2,
					CASE WHEN $3 = 'posts' THEN 1 ELSE 0 END,
					CASE WHEN $3 = 'api_calls' THEN 1 ELSE 0 END,
					CASE WHEN $3 = 'comments' THEN 1 ELSE 0 END,
					CASE WHEN $3 = 'messages' THEN 1 ELSE 0 END,
					NOW(), NOW()
				)
			`
			if _, err := tx.ExecContext(ctx, insertQuery, accountID, truncDate, metric); err != nil {
				return false, 0, fmt.Errorf("failed to insert initial daily quota: %w", err)
			}
			if err := tx.Commit(); err != nil {
				return false, 0, fmt.Errorf("failed to commit: %w", err)
			}
			return true, 1, nil
		}
		return false, 0, fmt.Errorf("failed to query daily quota: %w", err)
	}

	var currentCount int
	var colName string
	switch metric {
	case "posts":
		currentCount = posts
		colName = "published_posts"
	case "api_calls":
		currentCount = apiCalls
		colName = "api_calls_made"
	case "comments":
		currentCount = comments
		colName = "comments_sent"
	case "messages":
		currentCount = messages
		colName = "messages_sent"
	default:
		return false, 0, ErrQuotaExceeded
	}

	if currentCount >= limit {
		_ = tx.Commit()
		return false, currentCount, nil
	}

	newCount := currentCount + 1
	updateQuery := fmt.Sprintf(`
		UPDATE daily_quotas
		SET %s = %s + 1, updated_at = NOW()
		WHERE account_id = $1 AND quota_date = $2
	`, colName, colName)

	if _, err := tx.ExecContext(ctx, updateQuery, accountID, truncDate); err != nil {
		return false, 0, fmt.Errorf("failed to increment quota: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return false, 0, fmt.Errorf("failed to commit: %w", err)
	}

	return true, newCount, nil
}

func (r *PostgresRepository) GetDailyQuota(ctx context.Context, accountID string, quotaDate time.Time) (*DailyQuota, error) {
	truncDate := time.Date(quotaDate.Year(), quotaDate.Month(), quotaDate.Day(), 0, 0, 0, 0, time.UTC)
	query := `
		SELECT account_id, quota_date, published_posts, api_calls_made, comments_sent, messages_sent, created_at, updated_at
		FROM daily_quotas
		WHERE account_id = $1 AND quota_date = $2
	`
	var q DailyQuota
	err := r.db.QueryRowContext(ctx, query, accountID, truncDate).Scan(
		&q.AccountID,
		&q.QuotaDate,
		&q.PublishedPosts,
		&q.APICallsMade,
		&q.CommentsSent,
		&q.MessagesSent,
		&q.CreatedAt,
		&q.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return &DailyQuota{
				AccountID: accountID,
				QuotaDate: truncDate,
			}, nil
		}
		return nil, fmt.Errorf("failed to get daily quota: %w", err)
	}
	return &q, nil
}

// --- Daily Insights Snapshots (Feature 28) ---

func (r *PostgresRepository) SaveInsightsSnapshot(ctx context.Context, snapshot *InsightsSnapshot) error {
	query := `
		INSERT INTO insights_snapshots (id, account_id, snapshot_date, metrics, created_at)
		VALUES ($1, $2, $3, $4, NOW())
		ON CONFLICT (account_id, snapshot_date)
		DO UPDATE SET metrics = EXCLUDED.metrics
		RETURNING id, created_at
	`
	if snapshot.ID == uuid.Nil {
		snapshot.ID = uuid.New()
	}
	truncDate := time.Date(snapshot.SnapshotDate.Year(), snapshot.SnapshotDate.Month(), snapshot.SnapshotDate.Day(), 0, 0, 0, 0, time.UTC)

	err := r.db.QueryRowContext(ctx, query,
		snapshot.ID,
		snapshot.AccountID,
		truncDate,
		snapshot.Metrics,
	).Scan(&snapshot.ID, &snapshot.CreatedAt)
	if err != nil {
		return fmt.Errorf("failed to save insights snapshot: %w", err)
	}
	return nil
}

func (r *PostgresRepository) GetInsightsSnapshot(ctx context.Context, accountID string, date time.Time) (*InsightsSnapshot, error) {
	truncDate := time.Date(date.Year(), date.Month(), date.Day(), 0, 0, 0, 0, time.UTC)
	query := `
		SELECT id, account_id, snapshot_date, metrics, created_at
		FROM insights_snapshots
		WHERE account_id = $1 AND snapshot_date = $2
	`
	var s InsightsSnapshot
	err := r.db.QueryRowContext(ctx, query, accountID, truncDate).Scan(
		&s.ID,
		&s.AccountID,
		&s.SnapshotDate,
		&s.Metrics,
		&s.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("failed to get insights snapshot: %w", err)
	}
	return &s, nil
}

func (r *PostgresRepository) ListInsightsSnapshots(ctx context.Context, accountID string, limit int) ([]*InsightsSnapshot, error) {
	if limit <= 0 {
		limit = 30
	}
	query := `
		SELECT id, account_id, snapshot_date, metrics, created_at
		FROM insights_snapshots
		WHERE account_id = $1
		ORDER BY snapshot_date DESC
		LIMIT $2
	`
	rows, err := r.db.QueryContext(ctx, query, accountID, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to list insights snapshots: %w", err)
	}
	defer rows.Close()

	var snapshots []*InsightsSnapshot
	for rows.Next() {
		var s InsightsSnapshot
		if err := rows.Scan(&s.ID, &s.AccountID, &s.SnapshotDate, &s.Metrics, &s.CreatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan insights snapshot: %w", err)
		}
		snapshots = append(snapshots, &s)
	}
	return snapshots, nil
}

// --- Webhook Events (Features 20, 21) ---

func (r *PostgresRepository) SaveWebhookEvent(ctx context.Context, event *WebhookEvent) error {
	if event.ID == uuid.Nil {
		event.ID = uuid.New()
	}
	query := `
		INSERT INTO webhook_events (id, event_id, field, payload, signature_verified, processed, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, NOW())
	`
	_, err := r.db.ExecContext(ctx, query,
		event.ID,
		event.EventID,
		event.Field,
		event.Payload,
		event.SignatureVerified,
		event.Processed,
	)
	if err != nil {
		return fmt.Errorf("failed to save webhook event: %w", err)
	}
	return nil
}

func (r *PostgresRepository) ClaimUnprocessedWebhookEvents(ctx context.Context, batchSize int) ([]*WebhookEvent, error) {
	if batchSize <= 0 {
		batchSize = 20
	}
	query := `
		SELECT id, event_id, field, payload, signature_verified, processed, processed_at, error_message, created_at
		FROM webhook_events
		WHERE processed = FALSE
		ORDER BY created_at ASC
		LIMIT $1
		FOR UPDATE SKIP LOCKED
	`
	rows, err := r.db.QueryContext(ctx, query, batchSize)
	if err != nil {
		return nil, fmt.Errorf("failed to query unprocessed webhook events: %w", err)
	}
	defer rows.Close()

	var events []*WebhookEvent
	for rows.Next() {
		var ev WebhookEvent
		var eventID, errMsg sql.NullString
		var processedAt sql.NullTime
		if err := rows.Scan(
			&ev.ID,
			&eventID,
			&ev.Field,
			&ev.Payload,
			&ev.SignatureVerified,
			&ev.Processed,
			&processedAt,
			&errMsg,
			&ev.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan webhook event: %w", err)
		}
		if eventID.Valid {
			ev.EventID = &eventID.String
		}
		if errMsg.Valid {
			ev.ErrorMessage = &errMsg.String
		}
		if processedAt.Valid {
			ev.ProcessedAt = &processedAt.Time
		}
		events = append(events, &ev)
	}
	return events, nil
}

func (r *PostgresRepository) MarkWebhookEventProcessed(ctx context.Context, id uuid.UUID, errMsg *string) error {
	query := `
		UPDATE webhook_events
		SET processed = TRUE, processed_at = NOW(), error_message = $2
		WHERE id = $1
	`
	_, err := r.db.ExecContext(ctx, query, id, errMsg)
	if err != nil {
		return fmt.Errorf("failed to mark webhook event processed: %w", err)
	}
	return nil
}

// --- Audit Logs (Feature 21) ---

func (r *PostgresRepository) SaveAuditLog(ctx context.Context, log *AuditLog) error {
	if log.ID == uuid.Nil {
		log.ID = uuid.New()
	}
	query := `
		INSERT INTO audit_logs (id, account_id, action_type, target_id, rule_id, details, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, NOW())
	`
	_, err := r.db.ExecContext(ctx, query,
		log.ID,
		log.AccountID,
		log.ActionType,
		log.TargetID,
		log.RuleID,
		log.Details,
	)
	if err != nil {
		return fmt.Errorf("failed to save audit log: %w", err)
	}
	return nil
}

func (r *PostgresRepository) ListAuditLogs(ctx context.Context, accountID string, limit int) ([]*AuditLog, error) {
	if limit <= 0 {
		limit = 50
	}
	query := `
		SELECT id, account_id, action_type, target_id, rule_id, details, created_at
		FROM audit_logs
		WHERE account_id = $1
		ORDER BY created_at DESC
		LIMIT $2
	`
	rows, err := r.db.QueryContext(ctx, query, accountID, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to query audit logs: %w", err)
	}
	defer rows.Close()

	var logs []*AuditLog
	for rows.Next() {
		var l AuditLog
		var targetID, ruleID sql.NullString
		if err := rows.Scan(
			&l.ID,
			&l.AccountID,
			&l.ActionType,
			&targetID,
			&ruleID,
			&l.Details,
			&l.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan audit log: %w", err)
		}
		if targetID.Valid {
			l.TargetID = &targetID.String
		}
		if ruleID.Valid {
			l.RuleID = &ruleID.String
		}
		logs = append(logs, &l)
	}
	return logs, nil
}
