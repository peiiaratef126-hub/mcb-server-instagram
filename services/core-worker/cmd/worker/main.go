package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/peiiaratef126-hub/mcb-server-instagram/services/core-worker/internal/db"
	"github.com/peiiaratef126-hub/mcb-server-instagram/services/core-worker/internal/insights"
	"github.com/peiiaratef126-hub/mcb-server-instagram/services/core-worker/internal/logging"
	"github.com/peiiaratef126-hub/mcb-server-instagram/services/core-worker/internal/token"
)

const (
	ServiceName = "core-worker"
	Version     = "0.1.0-alpha.0"
)

func main() {
	// Initialize structured slog with automated secret scrubbing strictly to stderr
	logger := logging.SetupGlobalLogger(slog.LevelInfo, os.Stderr)
	logger.Info("Starting core-worker...", "service", ServiceName, "version", Version)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	dbURL := os.Getenv("DATABASE_URL")
	var repo db.Repository

	if dbURL != "" {
		logger.Info("Connecting to PostgreSQL database...")
		conn, err := db.ConnectWithRetry(ctx, dbURL, db.DefaultPoolConfig(), 5, 2*time.Second)
		if err != nil {
			logger.Error("Failed to connect to PostgreSQL", "error", err)
			os.Exit(1)
		}
		defer conn.Close()
		repo = db.NewPostgresRepository(conn)
	} else {
		logger.Warn("DATABASE_URL not set; running with in-memory repository (standalone/test mode)")
		repo = db.NewMemoryRepository()
	}

	encKey := os.Getenv("TOKEN_ENCRYPTION_KEY")
	accountID := os.Getenv("INSTAGRAM_ACCOUNT_ID")
	appID := os.Getenv("META_APP_ID")
	appSecret := os.Getenv("META_APP_SECRET")
	graphVersion := os.Getenv("META_GRAPH_VERSION")
	if graphVersion == "" {
		graphVersion = "v21.0"
	}

	if encKey != "" && accountID != "" {
		tokenSvc, err := token.NewService(repo, token.Config{
			AccountID:     accountID,
			AppID:         appID,
			AppSecret:     appSecret,
			GraphVersion:  graphVersion,
			EncryptionKey: encKey,
		})
		if err != nil {
			logger.Error("Failed to initialize TokenService", "error", err)
			os.Exit(1)
		}

		// Initial boot migration if env token provided
		if envToken := os.Getenv("INSTAGRAM_ACCESS_TOKEN"); envToken != "" {
			if err := tokenSvc.InitializeFromEnv(ctx, envToken); err != nil {
				logger.Error("Failed to migrate access token from environment", "error", err)
			}
		}

		// Internal token HTTP server
		port := os.Getenv("INTERNAL_API_PORT")
		if port == "" {
			port = "8081"
		}
		addr := fmt.Sprintf(":%s", port)
		tokenServer := token.NewServer(tokenSvc, addr)

		go func() {
			logger.Info("Internal token API listening", "addr", addr)
			if err := tokenServer.Start(); err != nil && err != http.ErrServerClosed {
				logger.Error("Internal token server encountered error", "error", err)
			}
		}()

		// Token refresh background daemon
		refreshDaemon := token.NewRefreshDaemon(tokenSvc, 1*time.Hour, 7*24*time.Hour)
		go refreshDaemon.Run(ctx)

		// Daily insights snapshot scheduler
		insightsClient := insights.NewGraphClient("https://graph.facebook.com", graphVersion, nil)
		snapshotRunner := insights.NewSnapshotRunner(repo, insightsClient, tokenSvc.GetActiveToken, accountID)
		go snapshotRunner.SchedulePeriodic(ctx, 24*time.Hour)
	} else {
		logger.Warn("TOKEN_ENCRYPTION_KEY or INSTAGRAM_ACCOUNT_ID not set; token service and daemon not started")
	}

	logger.Info("core-worker successfully initialized and ready", "service", ServiceName)

	<-ctx.Done()
	logger.Info("Shutdown signal received; shutting down core-worker gracefully...")
}
