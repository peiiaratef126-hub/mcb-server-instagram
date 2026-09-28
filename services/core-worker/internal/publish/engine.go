package publish

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/peiiaratef126-hub/mcb-server-instagram/services/core-worker/internal/db"
)

type TokenProvider func(ctx context.Context) (string, error)

type PublishEngine struct {
	client          GraphPublishClient
	tokenProvider   TokenProvider
	pollInterval    time.Duration
	maxPollAttempts int
}

func NewPublishEngine(client GraphPublishClient, tokenProvider TokenProvider, pollInterval time.Duration) *PublishEngine {
	if pollInterval <= 0 {
		pollInterval = 2 * time.Second
	}
	return &PublishEngine{
		client:          client,
		tokenProvider:   tokenProvider,
		pollInterval:    pollInterval,
		maxPollAttempts: 30, // 30 * 2s = 60s max default poll timeout
	}
}

// ExecuteJob implements queue.JobExecutor, executing the full publishing state machine.
func (e *PublishEngine) ExecuteJob(ctx context.Context, job *db.PublishJob) error {
	var payload PublishPayload
	if err := json.Unmarshal(job.Payload, &payload); err != nil {
		return fmt.Errorf("failed to parse job payload JSON: %w", err)
	}

	token, err := e.tokenProvider(ctx)
	if err != nil {
		return fmt.Errorf("failed to obtain token for publishing: %w", err)
	}

	slog.Info("PublishEngine executing job",
		"job_id", job.ID,
		"account_id", job.AccountID,
		"media_type", job.MediaType,
	)

	var containerID, publishedMediaID string

	switch payload.MediaType {
	case MediaImage:
		containerID, publishedMediaID, err = e.publishImage(ctx, job.AccountID, token, payload)
	case MediaVideo:
		containerID, publishedMediaID, err = e.publishVideo(ctx, job.AccountID, token, payload, false)
	case MediaReels:
		containerID, publishedMediaID, err = e.publishVideo(ctx, job.AccountID, token, payload, true)
	case MediaCarousel:
		containerID, publishedMediaID, err = e.publishCarousel(ctx, job.AccountID, token, payload)
	default:
		return fmt.Errorf("unsupported media type: %s", payload.MediaType)
	}

	if err != nil {
		return err
	}

	job.ContainerID = &containerID
	job.PublishedMediaID = &publishedMediaID
	return nil
}

func (e *PublishEngine) publishImage(ctx context.Context, accountID, token string, p PublishPayload) (string, string, error) {
	if p.ImageURL == "" {
		return "", "", errors.New("image_url is required for image post")
	}

	// 1. Create image container
	containerID, err := e.client.CreateImageContainer(ctx, accountID, token, p.ImageURL, p.Caption, false)
	if err != nil {
		return "", "", fmt.Errorf("failed to create image container: %w", err)
	}

	// 2. Poll container status until FINISHED
	if err := e.pollUntilFinished(ctx, containerID, token); err != nil {
		return containerID, "", err
	}

	// 3. Publish container
	pubID, err := e.client.PublishContainer(ctx, accountID, token, containerID)
	if err != nil {
		return containerID, "", fmt.Errorf("failed to publish image container: %w", err)
	}

	return containerID, pubID, nil
}

func (e *PublishEngine) publishVideo(ctx context.Context, accountID, token string, p PublishPayload, isReels bool) (string, string, error) {
	if p.VideoURL == "" {
		return "", "", errors.New("video_url is required for video/reels post")
	}

	// 1. Create video container
	containerID, err := e.client.CreateVideoContainer(ctx, accountID, token, p.VideoURL, p.Caption, isReels, false)
	if err != nil {
		return "", "", fmt.Errorf("failed to create video container: %w", err)
	}

	// 2. Poll container status until FINISHED
	if err := e.pollUntilFinished(ctx, containerID, token); err != nil {
		return containerID, "", err
	}

	// 3. Publish container
	pubID, err := e.client.PublishContainer(ctx, accountID, token, containerID)
	if err != nil {
		return containerID, "", fmt.Errorf("failed to publish video container: %w", err)
	}

	return containerID, pubID, nil
}

func (e *PublishEngine) publishCarousel(ctx context.Context, accountID, token string, p PublishPayload) (string, string, error) {
	if len(p.CarouselItems) < 2 || len(p.CarouselItems) > 10 {
		return "", "", fmt.Errorf("carousel must contain between 2 and 10 items, got %d", len(p.CarouselItems))
	}

	// 1. Create child item containers
	childIDs := make([]string, 0, len(p.CarouselItems))
	for i, item := range p.CarouselItems {
		var childID string
		var err error

		if item.MediaType == MediaVideo || item.MediaType == MediaReels {
			childID, err = e.client.CreateVideoContainer(ctx, accountID, token, item.URL, "", false, true)
		} else {
			childID, err = e.client.CreateImageContainer(ctx, accountID, token, item.URL, "", true)
		}

		if err != nil {
			return "", "", fmt.Errorf("failed to create carousel item #%d container: %w", i+1, err)
		}
		childIDs = append(childIDs, childID)
	}

	// 2. Poll all child containers until FINISHED
	for _, childID := range childIDs {
		if err := e.pollUntilFinished(ctx, childID, token); err != nil {
			return "", "", fmt.Errorf("carousel child container %s failed: %w", childID, err)
		}
	}

	// 3. Create parent carousel container
	parentID, err := e.client.CreateCarouselContainer(ctx, accountID, token, childIDs, p.Caption)
	if err != nil {
		return "", "", fmt.Errorf("failed to create parent carousel container: %w", err)
	}

	// 4. Poll parent container until FINISHED
	if err := e.pollUntilFinished(ctx, parentID, token); err != nil {
		return parentID, "", fmt.Errorf("parent carousel container failed: %w", err)
	}

	// 5. Publish parent container
	pubID, err := e.client.PublishContainer(ctx, accountID, token, parentID)
	if err != nil {
		return parentID, "", fmt.Errorf("failed to publish carousel: %w", err)
	}

	return parentID, pubID, nil
}

func (e *PublishEngine) pollUntilFinished(ctx context.Context, containerID, token string) error {
	for attempt := 1; attempt <= e.maxPollAttempts; attempt++ {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		status, err := e.client.PollContainerStatus(ctx, containerID, token)
		if err != nil {
			slog.Warn("Transient error polling container status", "container_id", containerID, "error", err)
		} else {
			slog.Debug("Polled container status", "container_id", containerID, "status", status, "attempt", attempt)

			switch status {
			case "FINISHED":
				return nil
			case "ERROR", "EXPIRED":
				return fmt.Errorf("%w: status=%s", ErrContainerFailed, status)
			}
		}

		if attempt < e.maxPollAttempts {
			select {
			case <-time.After(e.pollInterval):
			case <-ctx.Done():
				return ctx.Err()
			}
		}
	}

	return fmt.Errorf("%w: container %s did not reach FINISHED within %d attempts", ErrContainerTimeout, containerID, e.maxPollAttempts)
}
