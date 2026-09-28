package publish

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

var (
	ErrContainerFailed  = errors.New("container processing failed on Meta Graph API")
	ErrContainerTimeout = errors.New("container processing timed out")
)

type GraphPublishClient interface {
	CreateImageContainer(ctx context.Context, accountID, accessToken, imageURL, caption string, isCarouselItem bool) (string, error)
	CreateVideoContainer(ctx context.Context, accountID, accessToken, videoURL, caption string, isReels bool, isCarouselItem bool) (string, error)
	CreateCarouselContainer(ctx context.Context, accountID, accessToken string, childrenIDs []string, caption string) (string, error)
	PollContainerStatus(ctx context.Context, containerID, accessToken string) (statusCode string, err error)
	PublishContainer(ctx context.Context, accountID, accessToken, containerID string) (publishedMediaID string, err error)
}

type HTTPGraphPublishClient struct {
	baseURL      string
	graphVersion string
	httpClient   *http.Client
}

func NewHTTPGraphPublishClient(baseURL, graphVersion string, httpClient *http.Client) *HTTPGraphPublishClient {
	if baseURL == "" {
		baseURL = "https://graph.facebook.com"
	}
	if graphVersion == "" {
		graphVersion = "v21.0"
	}
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 30 * time.Second}
	}
	return &HTTPGraphPublishClient{
		baseURL:      baseURL,
		graphVersion: graphVersion,
		httpClient:   httpClient,
	}
}

func (c *HTTPGraphPublishClient) CreateImageContainer(ctx context.Context, accountID, accessToken, imageURL, caption string, isCarouselItem bool) (string, error) {
	reqURL := fmt.Sprintf("%s/%s/%s/media", c.baseURL, c.graphVersion, accountID)
	data := url.Values{}
	data.Set("image_url", imageURL)
	data.Set("access_token", accessToken)
	if caption != "" && !isCarouselItem {
		data.Set("caption", caption)
	}
	if isCarouselItem {
		data.Set("is_carousel_item", "true")
	}

	return c.postFormForID(ctx, reqURL, data)
}

func (c *HTTPGraphPublishClient) CreateVideoContainer(ctx context.Context, accountID, accessToken, videoURL, caption string, isReels bool, isCarouselItem bool) (string, error) {
	reqURL := fmt.Sprintf("%s/%s/%s/media", c.baseURL, c.graphVersion, accountID)
	data := url.Values{}
	data.Set("video_url", videoURL)
	data.Set("access_token", accessToken)
	if isReels {
		data.Set("media_type", "REELS")
	} else {
		data.Set("media_type", "VIDEO")
	}
	if caption != "" && !isCarouselItem {
		data.Set("caption", caption)
	}
	if isCarouselItem {
		data.Set("is_carousel_item", "true")
	}

	return c.postFormForID(ctx, reqURL, data)
}

func (c *HTTPGraphPublishClient) CreateCarouselContainer(ctx context.Context, accountID, accessToken string, childrenIDs []string, caption string) (string, error) {
	reqURL := fmt.Sprintf("%s/%s/%s/media", c.baseURL, c.graphVersion, accountID)
	data := url.Values{}
	data.Set("media_type", "CAROUSEL")
	data.Set("children", strings.Join(childrenIDs, ","))
	data.Set("access_token", accessToken)
	if caption != "" {
		data.Set("caption", caption)
	}

	return c.postFormForID(ctx, reqURL, data)
}

func (c *HTTPGraphPublishClient) PollContainerStatus(ctx context.Context, containerID, accessToken string) (string, error) {
	reqURL := fmt.Sprintf("%s/%s/%s?fields=status_code,status&access_token=%s", c.baseURL, c.graphVersion, containerID, url.QueryEscape(accessToken))

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return "", err
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to poll container status: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("error polling container: HTTP %d %s", resp.StatusCode, string(body))
	}

	var parsed struct {
		StatusCode string `json:"status_code"`
		Status     string `json:"status"`
		Error      *struct {
			Message string `json:"message"`
		} `json:"error,omitempty"`
	}

	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", fmt.Errorf("failed to parse container poll response: %w", err)
	}

	if parsed.StatusCode == "" {
		parsed.StatusCode = "FINISHED" // Some image containers default immediately
	}

	return parsed.StatusCode, nil
}

func (c *HTTPGraphPublishClient) PublishContainer(ctx context.Context, accountID, accessToken, containerID string) (string, error) {
	reqURL := fmt.Sprintf("%s/%s/%s/media_publish", c.baseURL, c.graphVersion, accountID)
	data := url.Values{}
	data.Set("creation_id", containerID)
	data.Set("access_token", accessToken)

	return c.postFormForID(ctx, reqURL, data)
}

func (c *HTTPGraphPublishClient) postFormForID(ctx context.Context, reqURL string, data url.Values) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, reqURL, strings.NewReader(data.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("network error during post: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	var parsed struct {
		ID    string `json:"id"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error,omitempty"`
	}

	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", fmt.Errorf("failed to parse response: %w", err)
	}

	if resp.StatusCode != http.StatusOK || parsed.ID == "" {
		errMsg := "unknown graph api error"
		if parsed.Error != nil && parsed.Error.Message != "" {
			errMsg = parsed.Error.Message
		}
		return "", fmt.Errorf("graph api error (status %d): %s", resp.StatusCode, errMsg)
	}

	return parsed.ID, nil
}

// MockGraphPublishClient provides deterministic in-memory fixtures for tests.
type MockGraphPublishClient struct {
	CreateImageContainerFn    func(ctx context.Context, accountID, accessToken, imageURL, caption string, isCarouselItem bool) (string, error)
	CreateVideoContainerFn    func(ctx context.Context, accountID, accessToken, videoURL, caption string, isReels bool, isCarouselItem bool) (string, error)
	CreateCarouselContainerFn func(ctx context.Context, accountID, accessToken string, childrenIDs []string, caption string) (string, error)
	PollContainerStatusFn     func(ctx context.Context, containerID, accessToken string) (string, error)
	PublishContainerFn        func(ctx context.Context, accountID, accessToken, containerID string) (string, error)

	PollCallCounts map[string]int
}

func NewMockGraphPublishClient() *MockGraphPublishClient {
	return &MockGraphPublishClient{
		PollCallCounts: make(map[string]int),
	}
}

func (m *MockGraphPublishClient) CreateImageContainer(ctx context.Context, accountID, accessToken, imageURL, caption string, isCarouselItem bool) (string, error) {
	if m.CreateImageContainerFn != nil {
		return m.CreateImageContainerFn(ctx, accountID, accessToken, imageURL, caption, isCarouselItem)
	}
	return "mock_img_container_12345", nil
}

func (m *MockGraphPublishClient) CreateVideoContainer(ctx context.Context, accountID, accessToken, videoURL, caption string, isReels bool, isCarouselItem bool) (string, error) {
	if m.CreateVideoContainerFn != nil {
		return m.CreateVideoContainerFn(ctx, accountID, accessToken, videoURL, caption, isReels, isCarouselItem)
	}
	return "mock_vid_container_67890", nil
}

func (m *MockGraphPublishClient) CreateCarouselContainer(ctx context.Context, accountID, accessToken string, childrenIDs []string, caption string) (string, error) {
	if m.CreateCarouselContainerFn != nil {
		return m.CreateCarouselContainerFn(ctx, accountID, accessToken, childrenIDs, caption)
	}
	return "mock_carousel_container_99999", nil
}

func (m *MockGraphPublishClient) PollContainerStatus(ctx context.Context, containerID, accessToken string) (string, error) {
	if m.PollContainerStatusFn != nil {
		return m.PollContainerStatusFn(ctx, containerID, accessToken)
	}
	m.PollCallCounts[containerID]++
	if m.PollCallCounts[containerID] < 2 {
		return "IN_PROGRESS", nil
	}
	return "FINISHED", nil
}

func (m *MockGraphPublishClient) PublishContainer(ctx context.Context, accountID, accessToken, containerID string) (string, error) {
	if m.PublishContainerFn != nil {
		return m.PublishContainerFn(ctx, accountID, accessToken, containerID)
	}
	return "ig_media_published_555666", nil
}
