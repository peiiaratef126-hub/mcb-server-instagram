package db

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"time"

	_ "github.com/lib/pq"
)

// PoolConfig holds database connection pool tuning parameters.
type PoolConfig struct {
	MaxOpenConns    int
	MaxIdleConns    int
	ConnMaxLifetime time.Duration
	ConnMaxIdleTime time.Duration
}

// DefaultPoolConfig returns sensible production connection pool settings.
func DefaultPoolConfig() PoolConfig {
	return PoolConfig{
		MaxOpenConns:    25,
		MaxIdleConns:    10,
		ConnMaxLifetime: 30 * time.Minute,
		ConnMaxIdleTime: 5 * time.Minute,
	}
}

// Connect establishes a connection to PostgreSQL and verifies it with Ping.
func Connect(ctx context.Context, dsn string, config PoolConfig) (*sql.DB, error) {
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to open database handle: %w", err)
	}

	db.SetMaxOpenConns(config.MaxOpenConns)
	db.SetMaxIdleConns(config.MaxIdleConns)
	db.SetConnMaxLifetime(config.ConnMaxLifetime)
	db.SetConnMaxIdleTime(config.ConnMaxIdleTime)

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	if err := db.PingContext(pingCtx); err != nil {
		db.Close()
		return nil, fmt.Errorf("database ping failed: %w", err)
	}

	return db, nil
}

// ConnectWithRetry attempts to connect to PostgreSQL with exponential backoff.
func ConnectWithRetry(ctx context.Context, dsn string, config PoolConfig, maxAttempts int, initialBackoff time.Duration) (*sql.DB, error) {
	var db *sql.DB
	var err error
	backoff := initialBackoff

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		db, err = Connect(ctx, dsn, config)
		if err == nil {
			slog.Info("Successfully connected to PostgreSQL", "attempt", attempt)
			return db, nil
		}

		slog.Warn("PostgreSQL connection attempt failed, retrying...",
			"attempt", attempt,
			"max_attempts", maxAttempts,
			"backoff", backoff,
			"error", err,
		)

		if attempt < maxAttempts {
			select {
			case <-time.After(backoff):
			case <-ctx.Done():
				return nil, ctx.Err()
			}
			backoff *= 2
		}
	}

	return nil, fmt.Errorf("failed to connect to PostgreSQL after %d attempts: %w", maxAttempts, err)
}
