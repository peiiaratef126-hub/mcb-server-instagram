package config

import (
	"os"
	"strconv"
)

type Config struct {
	Port         string
	AppSecret    string
	VerifyToken  string
	DatabaseURL  string
	MaxBodyBytes int64
}

func Load() *Config {
	port := os.Getenv("GATEWAY_PORT")
	if port == "" {
		port = os.Getenv("PORT")
	}
	if port == "" {
		port = "8080"
	}

	appSecret := os.Getenv("META_APP_SECRET")
	verifyToken := os.Getenv("META_WEBHOOK_VERIFY_TOKEN")
	dbURL := os.Getenv("DATABASE_URL")

	maxBodyStr := os.Getenv("MAX_BODY_BYTES")
	maxBody := int64(256 * 1024) // 256 KB default
	if maxBodyStr != "" {
		if parsed, err := strconv.ParseInt(maxBodyStr, 10, 64); err == nil && parsed > 0 {
			maxBody = parsed
		}
	}

	return &Config{
		Port:         port,
		AppSecret:    appSecret,
		VerifyToken:  verifyToken,
		DatabaseURL:  dbURL,
		MaxBodyBytes: maxBody,
	}
}
