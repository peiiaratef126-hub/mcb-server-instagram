package main

import "testing"

func TestWorkerConstants(t *testing.T) {
	if ServiceName != "core-worker" {
		t.Fatalf("expected ServiceName 'core-worker', got '%s'", ServiceName)
	}
	if Version == "" {
		t.Fatal("expected non-empty Version")
	}
}
