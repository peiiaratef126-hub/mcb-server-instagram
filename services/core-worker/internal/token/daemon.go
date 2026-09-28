package token

import (
	"context"
	"log/slog"
	"time"
)

type RefreshDaemon struct {
	service       *Service
	checkInterval time.Duration
	refreshWindow time.Duration // e.g. refresh if token expires within this window (default: 7 days)
}

func NewRefreshDaemon(service *Service, checkInterval, refreshWindow time.Duration) *RefreshDaemon {
	if checkInterval <= 0 {
		checkInterval = 1 * time.Hour
	}
	if refreshWindow <= 0 {
		refreshWindow = 7 * 24 * time.Hour
	}
	return &RefreshDaemon{
		service:       service,
		checkInterval: checkInterval,
		refreshWindow: refreshWindow,
	}
}

func (d *RefreshDaemon) Run(ctx context.Context) {
	slog.Info("Starting token refresh daemon", "interval", d.checkInterval, "refresh_window", d.refreshWindow)
	ticker := time.NewTicker(d.checkInterval)
	defer ticker.Stop()

	// Initial check on boot
	d.checkAndRefresh(ctx)

	for {
		select {
		case <-ctx.Done():
			slog.Info("Stopping token refresh daemon")
			return
		case <-ticker.C:
			d.checkAndRefresh(ctx)
		}
	}
}

func (d *RefreshDaemon) checkAndRefresh(ctx context.Context) {
	meta, err := d.service.GetTokenMetadata(ctx)
	if err != nil {
		slog.Debug("Token refresh daemon: no token metadata available yet", "error", err)
		return
	}

	if meta.ExpiresAt == nil {
		// Non-expiring page token; no refresh needed
		slog.Debug("Token has no expiration date (perpetual page token); skipping refresh check")
		return
	}

	timeRemaining := time.Until(*meta.ExpiresAt)
	if timeRemaining <= d.refreshWindow {
		slog.Info("Token is within refresh window; initiating refresh...",
			"time_remaining", timeRemaining,
			"refresh_window", d.refreshWindow,
		)

		if err := d.service.RefreshToken(ctx); err != nil {
			slog.Error("Token refresh daemon failed to refresh token", "error", err)
		} else {
			slog.Info("Token refresh daemon successfully refreshed long-lived access token")
		}
	} else {
		slog.Debug("Token is healthy; refresh not yet needed", "time_remaining", timeRemaining)
	}
}
