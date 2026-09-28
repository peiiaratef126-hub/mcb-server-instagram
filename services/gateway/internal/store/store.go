package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"sync"
	"time"

	"github.com/google/uuid"
	_ "github.com/lib/pq"
)

type WebhookEvent struct {
	ID                uuid.UUID       `json:"id"`
	EventID           string          `json:"event_id"`
	Field             string          `json:"field"`
	Payload           json.RawMessage `json:"payload"`
	SignatureVerified bool            `json:"signature_verified"`
	Processed         bool            `json:"processed"`
	CreatedAt         time.Time       `json:"created_at"`
}

type EventStore interface {
	SaveEvent(ctx context.Context, event *WebhookEvent) error
}

type MemoryStore struct {
	mu     sync.RWMutex
	events []*WebhookEvent
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		events: make([]*WebhookEvent, 0),
	}
}

func (s *MemoryStore) SaveEvent(ctx context.Context, event *WebhookEvent) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if event.ID == uuid.Nil {
		event.ID = uuid.New()
	}
	if event.CreatedAt.IsZero() {
		event.CreatedAt = time.Now().UTC()
	}

	s.events = append(s.events, event)
	return nil
}

func (s *MemoryStore) GetEvents() []*WebhookEvent {
	s.mu.RLock()
	defer s.mu.RUnlock()

	res := make([]*WebhookEvent, len(s.events))
	copy(res, s.events)
	return res
}

func (s *MemoryStore) Count() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.events)
}

type PostgresStore struct {
	db *sql.DB
}

func NewPostgresStore(db *sql.DB) *PostgresStore {
	return &PostgresStore{db: db}
}

func (s *PostgresStore) SaveEvent(ctx context.Context, event *WebhookEvent) error {
	if event.ID == uuid.Nil {
		event.ID = uuid.New()
	}
	if event.CreatedAt.IsZero() {
		event.CreatedAt = time.Now().UTC()
	}

	query := `
		INSERT INTO webhook_events (id, event_id, field, payload, signature_verified, processed, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`
	_, err := s.db.ExecContext(
		ctx,
		query,
		event.ID,
		event.EventID,
		event.Field,
		event.Payload,
		event.SignatureVerified,
		event.Processed,
		event.CreatedAt,
	)
	return err
}
