package publish

import (
	"context"
	"encoding/json"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/peiiaratef126-hub/mcb-server-instagram/services/core-worker/internal/db"
	"github.com/peiiaratef126-hub/mcb-server-instagram/services/core-worker/internal/queue"
)

type trackingPublishClient struct {
	*MockGraphPublishClient
	containerCreateCount int64
	publishCount         int64
	pollCount            int64
}

func newTrackingPublishClient() *trackingPublishClient {
	mock := NewMockGraphPublishClient()
	return &trackingPublishClient{
		MockGraphPublishClient: mock,
	}
}

func (c *trackingPublishClient) CreateVideoContainer(ctx context.Context, accountID, accessToken, videoURL, caption string, isReels bool, isCarouselItem bool) (string, error) {
	atomic.AddInt64(&c.containerCreateCount, 1)
	return c.MockGraphPublishClient.CreateVideoContainer(ctx, accountID, accessToken, videoURL, caption, isReels, isCarouselItem)
}

func (c *trackingPublishClient) PollContainerStatus(ctx context.Context, containerID, accessToken string) (string, error) {
	atomic.AddInt64(&c.pollCount, 1)
	return c.MockGraphPublishClient.PollContainerStatus(ctx, containerID, accessToken)
}

func (c *trackingPublishClient) PublishContainer(ctx context.Context, accountID, accessToken, containerID string) (string, error) {
	atomic.AddInt64(&c.publishCount, 1)
	return c.MockGraphPublishClient.PublishContainer(ctx, accountID, accessToken, containerID)
}

func TestConcurrentWorker_EndToEndPublishingLifecycle(t *testing.T) {
	ctx := context.Background()
	repo := db.NewMemoryRepository()
	client := newTrackingPublishClient()

	tokenProvider := func(ctx context.Context) (string, error) {
		return "EAAG_mock_valid_token_e2e", nil
	}

	engine := NewPublishEngine(client, tokenProvider, 5*time.Millisecond)

	// 1. Enqueue real video publishing job into publish_queue
	jobID := uuid.New()
	payloadBytes, err := json.Marshal(PublishPayload{
		MediaType: MediaReels,
		Caption:   "Official MCP Server Launched! 🚀",
		VideoURL:  "https://cdn.example.com/videos/launch.mp4",
	})
	if err != nil {
		t.Fatalf("failed to marshal payload: %v", err)
	}

	dummyJob := &db.PublishJob{
		ID:             jobID,
		IdempotencyKey: "e2e-pub-job-123",
		AccountID:      "17841400000000001",
		MediaType:      "REELS",
		Payload:        payloadBytes,
		Status:         db.StatusPending,
		NextRunAt:      time.Now().UTC().Add(-1 * time.Second), // Ready immediately
	}

	if _, err := repo.EnqueuePublishJob(ctx, dummyJob); err != nil {
		t.Fatalf("failed to enqueue job: %v", err)
	}

	// 2. Spin up two concurrent workers competing for the job
	worker1 := queue.NewWorker("worker-alpha", repo, engine, 50*time.Millisecond)
	worker2 := queue.NewWorker("worker-beta", repo, engine, 50*time.Millisecond)

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

	// 3. Trigger concurrent execution simultaneously
	close(startSignal)
	wg.Wait()

	if worker1Err != nil {
		t.Fatalf("worker1 error: %v", worker1Err)
	}
	if worker2Err != nil {
		t.Fatalf("worker2 error: %v", worker2Err)
	}

	// 4. Concurrency assertion: strictly one worker won
	if worker1Claimed && worker2Claimed {
		t.Fatalf("CRITICAL RACE CONDITION: Both workers claimed the same job!")
	}
	if !worker1Claimed && !worker2Claimed {
		t.Fatalf("No worker claimed the job!")
	}

	// 5. Lifecycle assertion: Container -> Poll -> Publish executed strictly once
	containerCreations := atomic.LoadInt64(&client.containerCreateCount)
	publishes := atomic.LoadInt64(&client.publishCount)
	polls := atomic.LoadInt64(&client.pollCount)

	if containerCreations != 1 {
		t.Fatalf("expected exactly 1 container creation, got %d", containerCreations)
	}
	if publishes != 1 {
		t.Fatalf("DOUBLE POSTING DETECTED: expected exactly 1 publish call, got %d", publishes)
	}
	if polls < 2 {
		t.Fatalf("expected at least 2 status polls (IN_PROGRESS -> FINISHED), got %d", polls)
	}

	// 6. Database state assertion
	finalJob, err := repo.GetPublishJob(ctx, jobID)
	if err != nil {
		t.Fatalf("failed to get final job state: %v", err)
	}

	if finalJob.Status != db.StatusPublished {
		t.Fatalf("expected final status published, got %s", finalJob.Status)
	}
	if finalJob.PublishedMediaID == nil || *finalJob.PublishedMediaID == "" {
		t.Fatalf("expected non-empty published_media_id")
	}
	if finalJob.ContainerID == nil || *finalJob.ContainerID == "" {
		t.Fatalf("expected non-empty container_id")
	}
}
