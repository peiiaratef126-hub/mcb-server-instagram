package logging

import (
	"context"
	"io"
	"log/slog"
	"os"
	"regexp"
	"strings"
)

var (
	// Regex patterns for sensitive values
	eaagTokenPattern   = regexp.MustCompile(`(?i)EAAG[a-zA-Z0-9_-]+`)
	bearerPattern      = regexp.MustCompile(`(?i)Bearer\s+[a-zA-Z0-9_\-\.]+`)
	urlSecretPattern   = regexp.MustCompile(`(?i)(client_secret|fb_exchange_token|access_token)=([^&\s]+)`)
)

// SensitiveKeyNames defines attribute keys that must always have their values redacted.
var SensitiveKeyNames = map[string]bool{
	"token":                true,
	"access_token":         true,
	"client_secret":        true,
	"app_secret":           true,
	"secret":               true,
	"authorization":        true,
	"token_encryption_key": true,
	"encryption_key":       true,
	"key":                  true,
	"password":             true,
	"nonce":                true,
	"token_ciphertext":     true,
	"fb_exchange_token":    true,
}

// ScrubberHandler wraps an slog.Handler to scrub sensitive data before emitting logs.
type ScrubberHandler struct {
	next slog.Handler
}

// NewScrubberHandler wraps the given handler with automated secret scrubbing.
func NewScrubberHandler(next slog.Handler) *ScrubberHandler {
	return &ScrubberHandler{next: next}
}

func (h *ScrubberHandler) Enabled(ctx context.Context, level slog.Level) bool {
	return h.next.Enabled(ctx, level)
}

func (h *ScrubberHandler) Handle(ctx context.Context, r slog.Record) error {
	// Scrub the log message itself
	scrubbedMsg := ScrubString(r.Message)
	newRecord := slog.NewRecord(r.Time, r.Level, scrubbedMsg, r.PC)

	// Scrub all attributes
	r.Attrs(func(a slog.Attr) bool {
		newRecord.AddAttrs(h.scrubAttr(a))
		return true
	})

	return h.next.Handle(ctx, newRecord)
}

func (h *ScrubberHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	scrubbed := make([]slog.Attr, 0, len(attrs))
	for _, a := range attrs {
		scrubbed = append(scrubbed, h.scrubAttr(a))
	}
	return &ScrubberHandler{next: h.next.WithAttrs(scrubbed)}
}

func (h *ScrubberHandler) WithGroup(name string) slog.Handler {
	return &ScrubberHandler{next: h.next.WithGroup(name)}
}

func (h *ScrubberHandler) scrubAttr(a slog.Attr) slog.Attr {
	// Check key name
	keyLower := strings.ToLower(a.Key)
	if SensitiveKeyNames[keyLower] {
		return slog.String(a.Key, "[REDACTED]")
	}

	// Scrub value based on kind
	switch a.Value.Kind() {
	case slog.KindString:
		return slog.String(a.Key, ScrubString(a.Value.String()))
	case slog.KindGroup:
		attrs := a.Value.Group()
		scrubbedGroup := make([]slog.Attr, 0, len(attrs))
		for _, child := range attrs {
			scrubbedGroup = append(scrubbedGroup, h.scrubAttr(child))
		}
		return slog.Group(a.Key, anySlice(scrubbedGroup)...)
	default:
		return a
	}
}

func anySlice(attrs []slog.Attr) []any {
	anys := make([]any, len(attrs))
	for i, a := range attrs {
		anys[i] = a
	}
	return anys
}

// ScrubString replaces all known tokens, bearer headers, and secret query parameters with [REDACTED].
func ScrubString(input string) string {
	if input == "" {
		return input
	}
	res := eaagTokenPattern.ReplaceAllString(input, "EAAG[REDACTED]")
	res = bearerPattern.ReplaceAllString(res, "Bearer [REDACTED]")
	res = urlSecretPattern.ReplaceAllString(res, "$1=[REDACTED]")
	return res
}

// SetupGlobalLogger initializes the global slog default logger with JSON formatting and secret scrubbing.
func SetupGlobalLogger(level slog.Level, out io.Writer) *slog.Logger {
	if out == nil {
		out = os.Stderr
	}

	jsonHandler := slog.NewJSONHandler(out, &slog.HandlerOptions{
		Level: level,
	})

	scrubber := NewScrubberHandler(jsonHandler)
	logger := slog.New(scrubber)
	slog.SetDefault(logger)
	return logger
}
