package db

import (
	"context"
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"
)

// MemoryRepository implements Repository in memory with thread safety.
type MemoryRepository struct {
	mu sync.Mutex

	tokens        map[string]*AccessToken
	queue         map[uuid.UUID]*PublishJob
	quotas        map[string]*DailyQuota // key: accountID + ":" + YYYY-MM-DD
	snapshots     map[string]*InsightsSnapshot // key: accountID + ":" + YYYY-MM-DD
	webhookEvents map[uuid.UUID]*WebhookEvent
	auditLogs     []*AuditLog
}

// NewMemoryRepository initializes an empty in-memory repository.
func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{
		tokens:        make(map[string]*AccessToken),
		queue:         make(map[uuid.UUID]*PublishJob),
		quotas:        make(map[string]*DailyQuota),
		snapshots:     make(map[string]*InsightsSnapshot),
		webhookEvents: make(map[uuid.UUID]*WebhookEvent),
		auditLogs:     make([]*AuditLog, 0),
	}
}

func (m *MemoryRepository) Ping(ctx context.Context) error {
	return nil
}

func (m *MemoryRepository) Close() error {
	return nil
}

// --- Access Tokens ---

func (m *MemoryRepository) GetAccessToken(ctx context.Context, accountID string) (*AccessToken, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	t, exists := m.tokens[accountID]
	if !exists {
		return nil, ErrNotFound
	}
	cpy := *t
	return &cpy, nil
}

func (m *MemoryRepository) SaveAccessToken(ctx context.Context, token *AccessToken) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now().UTC()
	cpy := *token
	if cpy.CreatedAt.IsZero() {
		cpy.CreatedAt = now
	}
	cpy.UpdatedAt = now
	if cpy.LastRefreshedAt.IsZero() {
		cpy.LastRefreshedAt = now
	}

	m.tokens[token.AccountID] = &cpy
	return nil
}

func (m *MemoryRepository) UpdateAccessToken(ctx context.Context, token *AccessToken) error {
	return m.SaveAccessToken(ctx, token)
}

func (m *MemoryRepository) DeleteAccessToken(ctx context.Context, accountID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.tokens[accountID]; !exists {
		return ErrNotFound
	}
	delete(m.tokens, accountID)
	return nil
}

// --- Publish Queue ---

func (m *MemoryRepository) EnqueuePublishJob(ctx context.Context, job *PublishJob) (*PublishJob, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Check idempotency constraint
	for _, existing := range m.queue {
		if existing.AccountID == job.AccountID && existing.IdempotencyKey == job.IdempotencyKey {
			return nil, ErrDuplicateKey
		}
	}

	if job.ID == uuid.Nil {
		job.ID = uuid.New()
	}
	if job.Status == "" {
		job.Status = StatusPending
	}
	if job.MaxAttempts <= 0 {
		job.MaxAttempts = 5
	}
	now := time.Now().UTC()
	if job.NextRunAt.IsZero() {
		job.NextRunAt = now
	}
	job.CreatedAt = now
	job.UpdatedAt = now

	cpy := *job
	m.queue[job.ID] = &cpy
	return &cpy, nil
}

// ClaimNextPublishJob simulates SELECT ... FOR UPDATE SKIP LOCKED
func (m *MemoryRepository) ClaimNextPublishJob(ctx context.Context, workerID string) (*PublishJob, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now().UTC()
	var candidates []*PublishJob

	for _, j := range m.queue {
		isEligibleStatus := j.Status == StatusPending || j.Status == StatusScheduled || j.Status == StatusUploading
		if isEligibleStatus && !j.NextRunAt.After(now) {
			candidates = append(candidates, j)
		}
	}

	if len(candidates) == 0 {
		return nil, nil
	}

	// Order by next_run_at ASC
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].NextRunAt.Before(candidates[j].NextRunAt)
	})

	claimed := candidates[0]
	claimed.Status = StatusProcessing
	claimed.Attempts++
	claimed.UpdatedAt = now

	cpy := *claimed
	return &cpy, nil
}

func (m *MemoryRepository) UpdatePublishJob(ctx context.Context, job *PublishJob) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	existing, exists := m.queue[job.ID]
	if !exists {
		return ErrNotFound
	}

	existing.Status = job.Status
	existing.ContainerID = job.ContainerID
	existing.PublishedMediaID = job.PublishedMediaID
	existing.NextRunAt = job.NextRunAt
	existing.Attempts = job.Attempts
	existing.LastError = job.LastError
	existing.UpdatedAt = time.Now().UTC()

	return nil
}

func (m *MemoryRepository) GetPublishJob(ctx context.Context, id uuid.UUID) (*PublishJob, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	j, exists := m.queue[id]
	if !exists {
		return nil, ErrNotFound
	}
	cpy := *j
	return &cpy, nil
}

func (m *MemoryRepository) GetPublishJobByIdempotency(ctx context.Context, accountID string, idempotencyKey string) (*PublishJob, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	for _, j := range m.queue {
		if j.AccountID == accountID && j.IdempotencyKey == idempotencyKey {
			cpy := *j
			return &cpy, nil
		}
	}
	return nil, ErrNotFound
}

// --- Atomic Daily Quotas ---

func (m *MemoryRepository) CheckAndIncrementQuota(ctx context.Context, accountID string, quotaDate time.Time, metric string, limit int) (bool, int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	truncDate := time.Date(quotaDate.Year(), quotaDate.Month(), quotaDate.Day(), 0, 0, 0, 0, time.UTC)
	key := accountID + ":" + truncDate.Format("2006-01-02")

	q, exists := m.quotas[key]
	if !exists {
		q = &DailyQuota{
			AccountID: accountID,
			QuotaDate: truncDate,
			CreatedAt: time.Now().UTC(),
			UpdatedAt: time.Now().UTC(),
		}
		m.quotas[key] = q
	}

	var currentCount int
	var allowed bool
	switch metric {
	case "api_calls":
		if q.APICallsMade < limit {
			q.APICallsMade++
			currentCount = q.APICallsMade
			allowed = true
		} else {
			currentCount = q.APICallsMade
			allowed = false
		}
	case "posts":
		if q.PublishedPosts < limit {
			q.PublishedPosts++
			currentCount = q.PublishedPosts
			allowed = true
		} else {
			currentCount = q.PublishedPosts
			allowed = false
		}
	case "comments":
		if q.CommentsSent < limit {
			q.CommentsSent++
			currentCount = q.CommentsSent
			allowed = true
		} else {
			currentCount = q.CommentsSent
			allowed = false
		}
	case "messages":
		if q.MessagesSent < limit {
			q.MessagesSent++
			currentCount = q.MessagesSent
			allowed = true
		} else {
			currentCount = q.MessagesSent
			allowed = false
		}
	default:
		return false, 0, ErrQuotaExceeded
	}

	q.UpdatedAt = time.Now().UTC()
	return allowed, currentCount, nil
}

func (m *MemoryRepository) GetDailyQuota(ctx context.Context, accountID string, quotaDate time.Time) (*DailyQuota, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	truncDate := time.Date(quotaDate.Year(), quotaDate.Month(), quotaDate.Day(), 0, 0, 0, 0, time.UTC)
	key := accountID + ":" + truncDate.Format("2006-01-02")

	q, exists := m.quotas[key]
	if !exists {
		return &DailyQuota{
			AccountID: accountID,
			QuotaDate: truncDate,
		}, nil
	}
	cpy := *q
	return &cpy, nil
}

// --- Daily Insights Snapshots ---

func (m *MemoryRepository) SaveInsightsSnapshot(ctx context.Context, snapshot *InsightsSnapshot) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	truncDate := time.Date(snapshot.SnapshotDate.Year(), snapshot.SnapshotDate.Month(), snapshot.SnapshotDate.Day(), 0, 0, 0, 0, time.UTC)
	key := snapshot.AccountID + ":" + truncDate.Format("2006-01-02")

	if snapshot.ID == uuid.Nil {
		snapshot.ID = uuid.New()
	}
	snapshot.CreatedAt = time.Now().UTC()
	cpy := *snapshot
	m.snapshots[key] = &cpy
	return nil
}

func (m *MemoryRepository) GetInsightsSnapshot(ctx context.Context, accountID string, date time.Time) (*InsightsSnapshot, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	truncDate := time.Date(date.Year(), date.Month(), date.Day(), 0, 0, 0, 0, time.UTC)
	key := accountID + ":" + truncDate.Format("2006-01-02")

	s, exists := m.snapshots[key]
	if !exists {
		return nil, ErrNotFound
	}
	cpy := *s
	return &cpy, nil
}

func (m *MemoryRepository) ListInsightsSnapshots(ctx context.Context, accountID string, limit int) ([]*InsightsSnapshot, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if limit <= 0 {
		limit = 30
	}
	var res []*InsightsSnapshot
	for _, s := range m.snapshots {
		if s.AccountID == accountID {
			cpy := *s
			res = append(res, &cpy)
		}
	}

	sort.Slice(res, func(i, j int) bool {
		return res[i].SnapshotDate.After(res[j].SnapshotDate)
	})

	if len(res) > limit {
		res = res[:limit]
	}
	return res, nil
}

// --- Webhook Events (Features 20, 21) ---

func (m *MemoryRepository) SaveWebhookEvent(ctx context.Context, event *WebhookEvent) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if event.ID == uuid.Nil {
		event.ID = uuid.New()
	}
	if event.CreatedAt.IsZero() {
		event.CreatedAt = time.Now().UTC()
	}
	cpy := *event
	m.webhookEvents[event.ID] = &cpy
	return nil
}

func (m *MemoryRepository) ClaimUnprocessedWebhookEvents(ctx context.Context, batchSize int) ([]*WebhookEvent, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if batchSize <= 0 {
		batchSize = 20
	}
	var res []*WebhookEvent
	for _, ev := range m.webhookEvents {
		if !ev.Processed {
			cpy := *ev
			res = append(res, &cpy)
		}
	}

	sort.Slice(res, func(i, j int) bool {
		return res[i].CreatedAt.Before(res[j].CreatedAt)
	})

	if len(res) > batchSize {
		res = res[:batchSize]
	}
	return res, nil
}

func (m *MemoryRepository) MarkWebhookEventProcessed(ctx context.Context, id uuid.UUID, errMsg *string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	ev, exists := m.webhookEvents[id]
	if !exists {
		return ErrNotFound
	}
	ev.Processed = true
	now := time.Now().UTC()
	ev.ProcessedAt = &now
	ev.ErrorMessage = errMsg
	return nil
}

// --- Audit Logs (Feature 21) ---

func (m *MemoryRepository) SaveAuditLog(ctx context.Context, log *AuditLog) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if log.ID == uuid.Nil {
		log.ID = uuid.New()
	}
	if log.CreatedAt.IsZero() {
		log.CreatedAt = time.Now().UTC()
	}
	cpy := *log
	m.auditLogs = append(m.auditLogs, &cpy)
	return nil
}

func (m *MemoryRepository) ListAuditLogs(ctx context.Context, accountID string, limit int) ([]*AuditLog, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if limit <= 0 {
		limit = 50
	}
	var res []*AuditLog
	for _, l := range m.auditLogs {
		if l.AccountID == accountID {
			cpy := *l
			res = append(res, &cpy)
		}
	}

	sort.Slice(res, func(i, j int) bool {
		return res[i].CreatedAt.After(res[j].CreatedAt)
	})

	if len(res) > limit {
		res = res[:limit]
	}
	return res, nil
}
