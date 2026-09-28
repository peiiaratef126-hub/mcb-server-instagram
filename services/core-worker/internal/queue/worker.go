package queue

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/peiiaratef126-hub/mcb-server-instagram/services/core-worker/internal/db"
)

// JobExecutor defines the interface for running a claimed publish job.
type JobExecutor interface {
	ExecuteJob(ctx context.Context, job *db.PublishJob) error
}

// Worker represents a single worker node claiming and processing jobs from the queue.
type Worker struct {
	ID           string
	repo         db.Repository
	executor     JobExecutor
	pollInterval time.Duration
}

func NewWorker(id string, repo db.Repository, executor JobExecutor, pollInterval time.Duration) *Worker {
	if pollInterval <= 0 {
		pollInterval = 1 * time.Second
	}
	return &Worker{
		ID:           id,
		repo:         repo,
		executor:     executor,
		pollInterval: pollInterval,
	}
}

// ClaimAndProcessNext attempts to claim the next eligible job and execute it.
// Returns true if a job was claimed and processed, false if no job was available.
func (w *Worker) ClaimAndProcessNext(ctx context.Context) (bool, error) {
	job, err := w.repo.ClaimNextPublishJob(ctx, w.ID)
	if err != nil {
		return false, fmt.Errorf("worker %s error claiming job: %w", w.ID, err)
	}

	if job == nil {
		return false, nil // No jobs eligible to claim
	}

	slog.Info("Worker claimed job",
		"worker_id", w.ID,
		"job_id", job.ID,
		"account_id", job.AccountID,
		"media_type", job.MediaType,
		"attempt", job.Attempts,
	)

	// Execute job
	execErr := w.executor.ExecuteJob(ctx, job)
	if execErr != nil {
		slog.Error("Job execution failed",
			"worker_id", w.ID,
			"job_id", job.ID,
			"error", execErr,
			"attempt", job.Attempts,
			"max_attempts", job.MaxAttempts,
		)

		errStr := execErr.Error()
		job.LastError = &errStr

		if job.Attempts >= job.MaxAttempts {
			job.Status = db.StatusFailed
		} else {
			// Exponential backoff for retry
			backoff := time.Duration(1<<job.Attempts) * 10 * time.Second
			job.NextRunAt = time.Now().UTC().Add(backoff)
			job.Status = db.StatusPending
		}

		if updateErr := w.repo.UpdatePublishJob(ctx, job); updateErr != nil {
			slog.Error("Failed to update job status after execution failure", "job_id", job.ID, "error", updateErr)
		}
		return true, execErr
	}

	// Execution succeeded
	job.Status = db.StatusPublished
	publishedID := fmt.Sprintf("pub_%s", job.ID.String()[:8])
	job.PublishedMediaID = &publishedID

	if err := w.repo.UpdatePublishJob(ctx, job); err != nil {
		slog.Error("Failed to mark job published", "job_id", job.ID, "error", err)
		return true, fmt.Errorf("failed to mark job published: %w", err)
	}

	slog.Info("Job processed and published successfully",
		"worker_id", w.ID,
		"job_id", job.ID,
		"published_media_id", *job.PublishedMediaID,
	)

	return true, nil
}

// Start begins a continuous polling loop claiming and processing jobs.
func (w *Worker) Start(ctx context.Context) {
	slog.Info("Worker started polling loop", "worker_id", w.ID, "interval", w.pollInterval)
	ticker := time.NewTicker(w.pollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			slog.Info("Worker shutting down", "worker_id", w.ID)
			return
		case <-ticker.C:
			for {
				claimed, err := w.ClaimAndProcessNext(ctx)
				if err != nil {
					slog.Warn("Error processing job in loop", "worker_id", w.ID, "error", err)
				}
				if !claimed {
					break // No more ready jobs in queue
				}
			}
		}
	}
}
