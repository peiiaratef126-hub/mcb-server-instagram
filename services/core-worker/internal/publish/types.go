package publish

import (
	"time"

	"github.com/google/uuid"
)

type MediaType string

const (
	MediaImage    MediaType = "IMAGE"
	MediaVideo    MediaType = "VIDEO"
	MediaReels    MediaType = "REELS"
	MediaCarousel MediaType = "CAROUSEL"
)

type CarouselItem struct {
	MediaType MediaType `json:"media_type"`
	URL       string    `json:"url"`
}

type PublishPayload struct {
	MediaType     MediaType      `json:"media_type"`
	Caption       string         `json:"caption,omitempty"`
	ImageURL      string         `json:"image_url,omitempty"`
	VideoURL      string         `json:"video_url,omitempty"`
	CarouselItems []CarouselItem `json:"carousel_items,omitempty"`
	ScheduledAt   *time.Time     `json:"scheduled_at,omitempty"`
}

type PublishResult struct {
	JobID            uuid.UUID `json:"job_id"`
	ContainerID      string    `json:"container_id"`
	PublishedMediaID string    `json:"published_media_id"`
	Status           string    `json:"status"`
	PublishedAt      time.Time `json:"published_at"`
}
