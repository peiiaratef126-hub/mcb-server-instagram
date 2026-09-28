package errors

import (
	"fmt"
)

type ErrorCode string

const (
	CodeAuth        ErrorCode = "AUTHENTICATION_ERROR"
	CodeRateLimit   ErrorCode = "RATE_LIMIT_EXCEEDED"
	CodeQuota       ErrorCode = "QUOTA_EXCEEDED"
	CodeValidation  ErrorCode = "VALIDATION_ERROR"
	CodeNetwork     ErrorCode = "NETWORK_ERROR"
	CodeNotFound    ErrorCode = "NOT_FOUND"
	CodeConflict    ErrorCode = "CONFLICT"
	CodeInternal    ErrorCode = "INTERNAL_ERROR"
)

// DomainError represents a structured, domain-level error in core-worker.
type DomainError struct {
	Code      ErrorCode `json:"code"`
	Message   string    `json:"message"`
	Retryable bool      `json:"retryable"`
	Err       error     `json:"-"`
}

func (e *DomainError) Error() string {
	if e.Err != nil {
		return fmt.Sprintf("[%s] %s: %v", e.Code, e.Message, e.Err)
	}
	return fmt.Sprintf("[%s] %s", e.Code, e.Message)
}

func (e *DomainError) Unwrap() error {
	return e.Err
}

func NewDomainError(code ErrorCode, message string, retryable bool, cause error) *DomainError {
	return &DomainError{
		Code:      code,
		Message:   message,
		Retryable: retryable,
		Err:       cause,
	}
}

func NewAuthError(message string, cause error) *DomainError {
	return NewDomainError(CodeAuth, message, false, cause)
}

func NewRateLimitError(message string, cause error) *DomainError {
	return NewDomainError(CodeRateLimit, message, true, cause)
}

func NewQuotaError(message string, cause error) *DomainError {
	return NewDomainError(CodeQuota, message, false, cause)
}

func NewNetworkError(message string, cause error) *DomainError {
	return NewDomainError(CodeNetwork, message, true, cause)
}

func NewValidationError(message string, cause error) *DomainError {
	return NewDomainError(CodeValidation, message, false, cause)
}

// IsRetryable determines if a domain error can be safely retried with backoff.
func IsRetryable(err error) bool {
	if err == nil {
		return false
	}
	if de, ok := err.(*DomainError); ok {
		return de.Retryable
	}
	return false
}
