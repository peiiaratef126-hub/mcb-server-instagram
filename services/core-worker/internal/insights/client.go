package insights

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// Client defines the contract for fetching daily analytics from Meta Graph API.
type Client interface {
	GetAccountMetrics(ctx context.Context, accountID, accessToken string) (map[string]any, error)
	GetRecentMediaSummary(ctx context.Context, accountID, accessToken string, limit int) ([]map[string]any, error)
}

// GraphClient implements Client against official Meta Graph API.
type GraphClient struct {
	baseURL      string
	graphVersion string
	httpClient   *http.Client
}

func NewGraphClient(baseURL, graphVersion string, httpClient *http.Client) *GraphClient {
	if baseURL == "" {
		baseURL = "https://graph.facebook.com"
	}
	if graphVersion == "" {
		graphVersion = "v21.0"
	}
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 15 * time.Second}
	}
	return &GraphClient{
		baseURL:      baseURL,
		graphVersion: graphVersion,
		httpClient:   httpClient,
	}
}

func (c *GraphClient) GetAccountMetrics(ctx context.Context, accountID, accessToken string) (map[string]any, error) {
	reqURL, err := url.Parse(fmt.Sprintf("%s/%s/%s/insights", c.baseURL, c.graphVersion, accountID))
	if err != nil {
		return nil, err
	}

	q := reqURL.Query()
	q.Set("metric", "impressions,reach,profile_views,accounts_engaged")
	q.Set("period", "day")
	q.Set("access_token", accessToken)
	reqURL.RawQuery = q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL.String(), nil)
	if err != nil {
		return nil, err
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("network error querying account insights: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("graph api returned status %d: %s", resp.StatusCode, string(body))
	}

	var data map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, fmt.Errorf("failed to decode insights response: %w", err)
	}
	return data, nil
}

func (c *GraphClient) GetRecentMediaSummary(ctx context.Context, accountID, accessToken string, limit int) ([]map[string]any, error) {
	if limit <= 0 {
		limit = 10
	}
	reqURL, err := url.Parse(fmt.Sprintf("%s/%s/%s/media", c.baseURL, c.graphVersion, accountID))
	if err != nil {
		return nil, err
	}

	q := reqURL.Query()
	q.Set("fields", "id,caption,media_type,like_count,comments_count,timestamp")
	q.Set("limit", fmt.Sprintf("%d", limit))
	q.Set("access_token", accessToken)
	reqURL.RawQuery = q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL.String(), nil)
	if err != nil {
		return nil, err
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("network error querying media: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("graph api returned status %d: %s", resp.StatusCode, string(body))
	}

	var wrapper struct {
		Data []map[string]any `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&wrapper); err != nil {
		return nil, fmt.Errorf("failed to decode media response: %w", err)
	}
	return wrapper.Data, nil
}

// MockClient provides deterministic fixtures for testing.
type MockClient struct {
	AccountMetricsFn    func(ctx context.Context, accountID, accessToken string) (map[string]any, error)
	RecentMediaFn       func(ctx context.Context, accountID, accessToken string, limit int) ([]map[string]any, error)
}

func (m *MockClient) GetAccountMetrics(ctx context.Context, accountID, accessToken string) (map[string]any, error) {
	if m.AccountMetricsFn != nil {
		return m.AccountMetricsFn(ctx, accountID, accessToken)
	}
	return map[string]any{
		"impressions":      14500,
		"reach":            8200,
		"profile_views":    320,
		"accounts_engaged": 540,
	}, nil
}

func (m *MockClient) GetRecentMediaSummary(ctx context.Context, accountID, accessToken string, limit int) ([]map[string]any, error) {
	if m.RecentMediaFn != nil {
		return m.RecentMediaFn(ctx, accountID, accessToken, limit)
	}
	return []map[string]any{
		{
			"id":             "17999999999999991",
			"like_count":     342,
			"comments_count": 28,
		},
		{
			"id":             "17999999999999992",
			"like_count":     512,
			"comments_count": 45,
		},
	}, nil
}
