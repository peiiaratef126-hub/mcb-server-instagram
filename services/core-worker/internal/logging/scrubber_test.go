package logging

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"strings"
	"testing"
)

func TestScrubberHandler_KeyRedaction(t *testing.T) {
	var buf bytes.Buffer
	logger := SetupGlobalLogger(slog.LevelDebug, &buf)

	logger.Info("User requested operation",
		"account_id", "17841400000000001",
		"access_token", "EAAG_super_sensitive_token_value_9999",
		"encryption_key", "deadbeefcafe0123456789abcdef0123456789abcdef",
		"nonce", "test_nonce_value",
		"status", "ok",
	)

	output := buf.String()

	// Parse JSON
	var parsed map[string]any
	if err := json.Unmarshal([]byte(output), &parsed); err != nil {
		t.Fatalf("failed to parse log json output: %v. Raw: %s", err, output)
	}

	// Verify non-sensitive preserved
	if parsed["account_id"] != "17841400000000001" {
		t.Fatalf("account_id altered: %v", parsed["account_id"])
	}
	if parsed["status"] != "ok" {
		t.Fatalf("status altered: %v", parsed["status"])
	}

	// Verify sensitive keys redacted
	if parsed["access_token"] != "[REDACTED]" {
		t.Fatalf("access_token not redacted: %v", parsed["access_token"])
	}
	if parsed["encryption_key"] != "[REDACTED]" {
		t.Fatalf("encryption_key not redacted: %v", parsed["encryption_key"])
	}
	if parsed["nonce"] != "[REDACTED]" {
		t.Fatalf("nonce not redacted: %v", parsed["nonce"])
	}

	// Verify sensitive values do not appear anywhere in raw output
	if strings.Contains(output, "EAAG_super_sensitive_token_value_9999") {
		t.Fatalf("raw output leaks access token!")
	}
	if strings.Contains(output, "deadbeefcafe0123456789abcdef0123456789abcdef") {
		t.Fatalf("raw output leaks encryption key!")
	}
}

func TestScrubberHandler_MessageTextRedaction(t *testing.T) {
	var buf bytes.Buffer
	logger := SetupGlobalLogger(slog.LevelInfo, &buf)

	logger.Error("Failed call to https://graph.facebook.com/v21.0/oauth/access_token?client_secret=secret12345&fb_exchange_token=EAAG1234567890abcdef with Header Authorization: Bearer mySecretToken123")

	output := buf.String()

	if strings.Contains(output, "secret12345") {
		t.Fatalf("leaked client_secret in message: %s", output)
	}
	if strings.Contains(output, "EAAG1234567890abcdef") {
		t.Fatalf("leaked EAAG token in message: %s", output)
	}
	if strings.Contains(output, "mySecretToken123") {
		t.Fatalf("leaked Bearer token in message: %s", output)
	}

	// Verify [REDACTED] was inserted
	if !strings.Contains(output, "client_secret=[REDACTED]") {
		t.Fatalf("expected client_secret=[REDACTED] in output: %s", output)
	}
	if !strings.Contains(output, "Bearer [REDACTED]") {
		t.Fatalf("expected Bearer [REDACTED] in output: %s", output)
	}
}
