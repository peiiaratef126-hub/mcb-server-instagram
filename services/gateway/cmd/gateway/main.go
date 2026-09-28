package main

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	_ "github.com/lib/pq"
	"github.com/peiiaratef126-hub/mcb-server-instagram/services/gateway/internal/config"
	"github.com/peiiaratef126-hub/mcb-server-instagram/services/gateway/internal/handler"
	"github.com/peiiaratef126-hub/mcb-server-instagram/services/gateway/internal/store"
)

const (
	ServiceName = "gateway"
	Version     = "0.3.0-alpha.0"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	cfg := config.Load()
	logger.Info("Starting edge webhook gateway...", "service", ServiceName, "version", Version, "port", cfg.Port)

	var eventStore store.EventStore
	if cfg.DatabaseURL != "" {
		db, err := sql.Open("postgres", cfg.DatabaseURL)
		if err != nil {
			logger.Error("Failed to open postgres database connection", "error", err)
			os.Exit(1)
		}
		defer db.Close()

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := db.PingContext(ctx); err != nil {
			logger.Warn("Database not reachable yet; falling back to memory store for startup", "error", err)
			eventStore = store.NewMemoryStore()
		} else {
			logger.Info("Connected to PostgreSQL webhook store")
			eventStore = store.NewPostgresStore(db)
		}
	} else {
		logger.Warn("DATABASE_URL not set; running with ephemeral memory store")
		eventStore = store.NewMemoryStore()
	}

	webhookHandler := handler.NewWebhookHandler(cfg.AppSecret, cfg.VerifyToken, cfg.MaxBodyBytes, eventStore, logger)

	mux := http.NewServeMux()
	mux.Handle("/webhook", webhookHandler)
	mux.Handle("/healthz", webhookHandler)

	server := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		logger.Info(fmt.Sprintf("Gateway HTTP server listening on :%s", cfg.Port))
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("HTTP server failed", "error", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

	logger.Info("Shutting down edge webhook gateway...")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		logger.Error("Server shutdown error", "error", err)
	}
	logger.Info("Edge gateway stopped cleanly")
}
