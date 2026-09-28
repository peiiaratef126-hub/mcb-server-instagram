package queue

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/peiiaratef126-hub/mcb-server-instagram/services/core-worker/internal/db"
)

type mockExecutor struct {
	executeCount int64
	mu           sync.Mutex
	executedBy   []string
	delay        time.Duration
}

func (m *mockExecutor) ExecuteJob(ctx context.Context, job *db.PublishJob) error {
	atomic.AddInt64(&m.executeCount, 1)
	if m.delay > 0 {
		time.Sleep(m.delay)
	}
	return nil
}

func TestConcurrentWorker_ExactlyOnceClaim(t *testing.T) {
	ctx := context.Background()
	repo := db.NewMemoryRepository()

	// 1. Enqueue exactly one dummy publish job
	dummyJob := &db.PublishJob{
		ID:             uuid.New(),
		IdempotencyKey: "test-idem-001",
		AccountID:      "17841400000000001",
		MediaType:      "IMAGE",
		Payload:        []byte(`{"image_url":"https://example.com/photo.jpg","caption":"test"}`),
		Status:         db.StatusPending,
		NextRunAt:      time.Now().UTC().Add(-1 * time.Minute), // Ready immediately
	}

	enqueued, err := repo.EnqueuePublishJob(ctx, dummyJob)
	if err != nil {
		t.Fatalf("failed to enqueue job: %v", err)
	}

	executor := &mockExecutor{delay: 20 * time.Millisecond}

	// 2. Spin up two worker instances claiming concurrently
	worker1 := NewWorker("worker-alpha", repo, executor, 100*time.Millisecond)
	worker2 := NewWorker("worker-beta", repo, executor, 100*time.Millisecond)

	startSignal := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(2)

	var worker1Claimed, worker2Claimed bool
	var worker1Err, worker2Err error

	go func() {
		defer wg.Done()
		<-startSignal
		worker1Claimed, worker1Err = worker1.ClaimAndProcessNext(ctx)
	}()

	go func() {
		defer wg.Done()
		<-startSignal
		worker2Claimed, worker2Err = worker2.ClaimAndProcessNext(ctx)
	}()

	// Release both workers simultaneously
	close(startSignal)
	wg.Wait()

	if worker1Err != nil {
		t.Fatalf("worker1 error: %v", worker1Err)
	}
	if worker2Err != nil {
		t.Fatalf("worker2 error: %v", worker2Err)
	}

	// 3. Assertions:
	// Exactly one worker claimed the job, the other got claimed=false
	if worker1Claimed && worker2Claimed {
		t.Fatalf("DUPLICATE CLAIM: Both worker-alpha and worker-beta claimed the exact same job!")
	}
	if !worker1Claimed && !worker2Claimed {
		t.Fatalf("NO CLAIM: Neither worker claimed the job!")
	}

	// Exactly-once execution count
	totalExecutions := atomic.LoadInt64(&executor.executeCount)
	if totalExecutions != 1 {
		t.Fatalf("expected exactly 1 execution, got %d", totalExecutions)
	}

	// Verify job status in repository is published
	storedJob, err := repo.GetPublishJob(ctx, enqueued.ID)
	if err != nil {
		t.Fatalf("failed to get stored job: %v", err)
	}
	if storedJob.Status != db.StatusPublished {
		t.Fatalf("expected status published, got %s", storedJob.Status)
	}
	if storedJob.PublishedMediaID == nil || *storedJob.PublishedMediaID == "" {
		t.Fatalf("expected published_media_id to be populated")
	}
}

func TestConcurrentWorker_MultipleJobsPool(t *testing.T) {
	ctx := context.Background()
	repo := db.NewMemoryRepository()
	jobCount := 10
	workerCount := 4

	// Enqueue 10 jobs
	for i := 0; i < jobCount; i++ {
		job := &db.PublishJob{
			ID:             uuid.New(),
			IdempotencyKey: fmt.Sprintf("idem-key-%d", i),
			AccountID:      "17841400000000001",
			MediaType:      "IMAGE",
			Payload:        []byte(`{"image_url":"https://example.com/test.jpg"}`),
			Status:         db.StatusPending,
			NextRunAt:      time.Now().UTC().Add(-1 * time.Minute),
		}
		if _, err := repo.EnqueuePublishJob(ctx, job); err != nil {
			t.Fatalf("failed to enqueue job %d: %v", i, err)
		}
	}

	executor := &mockExecutor{delay: 5 * time.Millisecond}
	workers := make([]*Worker, workerCount)
	for i := 0; i < workerCount; i++ {
		workers[i] = NewWorker(fmt.Sprintf("worker-%d", i), repo, executor, 50*time.Millisecond)
	}

	startSignal := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(workerCount)

	// Run all workers concurrently until queue is empty
	for i := 0; i < workerCount; i++ {
		w := workers[i]
		go func() {
			defer wg.Done()
			<-startSignal
			for {
				claimed, err := w.ClaimAndProcessNext(ctx)
				if err != nil || !claimed {
					break
				}
			}
		}()
	}

	close(startSignal)
	wg.Wait()

	totalExecutions := atomic.LoadInt64(&executor.executeCount)
	if totalExecutions != int64(jobCount) {
		t.Fatalf("expected exactly %d executions, got %d", jobCount, totalExecutions)
	}
}
