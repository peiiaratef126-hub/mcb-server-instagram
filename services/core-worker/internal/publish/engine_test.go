package publish

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/peiiaratef126-hub/mcb-server-instagram/services/core-worker/internal/db"
)

func mockTokenProvider(ctx context.Context) (string, error) {
	return "EAAG_mock_valid_token_12345", nil
}

func TestPublishEngine_ImagePublish(t *testing.T) {
	ctx := context.Background()
	mockClient := NewMockGraphPublishClient()
	engine := NewPublishEngine(mockClient, mockTokenProvider, 10*time.Millisecond)

	payloadBytes, _ := json.Marshal(PublishPayload{
		MediaType: MediaImage,
		Caption:   "Beautiful sunset!",
		ImageURL:  "https://example.com/sunset.jpg",
	})

	job := &db.PublishJob{
		ID:        uuid.New(),
		AccountID: "17841400000000001",
		MediaType: "IMAGE",
		Payload:   payloadBytes,
	}

	if err := engine.ExecuteJob(ctx, job); err != nil {
		t.Fatalf("expected successful image publish, got: %v", err)
	}

	if job.ContainerID == nil || *job.ContainerID != "mock_img_container_12345" {
		t.Fatalf("expected container_id 'mock_img_container_12345', got %v", job.ContainerID)
	}
	if job.PublishedMediaID == nil || *job.PublishedMediaID != "ig_media_published_555666" {
		t.Fatalf("expected published_media_id 'ig_media_published_555666', got %v", job.PublishedMediaID)
	}
}

func TestPublishEngine_VideoReelsPublish(t *testing.T) {
	ctx := context.Background()
	mockClient := NewMockGraphPublishClient()
	engine := NewPublishEngine(mockClient, mockTokenProvider, 10*time.Millisecond)

	payloadBytes, _ := json.Marshal(PublishPayload{
		MediaType: MediaReels,
		Caption:   "Exciting Reel!",
		VideoURL:  "https://example.com/reel.mp4",
	})

	job := &db.PublishJob{
		ID:        uuid.New(),
		AccountID: "17841400000000001",
		MediaType: "REELS",
		Payload:   payloadBytes,
	}

	if err := engine.ExecuteJob(ctx, job); err != nil {
		t.Fatalf("expected successful reels publish, got: %v", err)
	}

	if job.ContainerID == nil || *job.ContainerID != "mock_vid_container_67890" {
		t.Fatalf("expected container_id 'mock_vid_container_67890', got %v", job.ContainerID)
	}
	if job.PublishedMediaID == nil || *job.PublishedMediaID != "ig_media_published_555666" {
		t.Fatalf("expected published_media_id 'ig_media_published_555666', got %v", job.PublishedMediaID)
	}
}

func TestPublishEngine_CarouselPublish(t *testing.T) {
	ctx := context.Background()
	mockClient := NewMockGraphPublishClient()
	engine := NewPublishEngine(mockClient, mockTokenProvider, 10*time.Millisecond)

	payloadBytes, _ := json.Marshal(PublishPayload{
		MediaType: MediaCarousel,
		Caption:   "Multi-slide carousel!",
		CarouselItems: []CarouselItem{
			{MediaType: MediaImage, URL: "https://example.com/slide1.jpg"},
			{MediaType: MediaImage, URL: "https://example.com/slide2.jpg"},
			{MediaType: MediaVideo, URL: "https://example.com/slide3.mp4"},
		},
	})

	job := &db.PublishJob{
		ID:        uuid.New(),
		AccountID: "17841400000000001",
		MediaType: "CAROUSEL",
		Payload:   payloadBytes,
	}

	if err := engine.ExecuteJob(ctx, job); err != nil {
		t.Fatalf("expected successful carousel publish, got: %v", err)
	}

	if job.ContainerID == nil || *job.ContainerID != "mock_carousel_container_99999" {
		t.Fatalf("expected parent container_id 'mock_carousel_container_99999', got %v", job.ContainerID)
	}
	if job.PublishedMediaID == nil || *job.PublishedMediaID != "ig_media_published_555666" {
		t.Fatalf("expected published_media_id 'ig_media_published_555666', got %v", job.PublishedMediaID)
	}
}

func TestPublishEngine_ContainerError(t *testing.T) {
	ctx := context.Background()
	mockClient := NewMockGraphPublishClient()
	mockClient.PollContainerStatusFn = func(ctx context.Context, containerID, accessToken string) (string, error) {
		return "ERROR", nil
	}
	engine := NewPublishEngine(mockClient, mockTokenProvider, 10*time.Millisecond)

	payloadBytes, _ := json.Marshal(PublishPayload{
		MediaType: MediaImage,
		ImageURL:  "https://example.com/fail.jpg",
	})

	job := &db.PublishJob{
		ID:        uuid.New(),
		AccountID: "17841400000000001",
		MediaType: "IMAGE",
		Payload:   payloadBytes,
	}

	err := engine.ExecuteJob(ctx, job)
	if err == nil {
		t.Fatalf("expected container error, got nil")
	}
	if !errors.Is(err, ErrContainerFailed) {
		t.Fatalf("expected ErrContainerFailed, got %v", err)
	}
}
