package main

import "testing"

func TestGatewayConstants(t *testing.T) {
	if ServiceName != "gateway" {
		t.Fatalf("expected ServiceName 'gateway', got '%s'", ServiceName)
	}
	if Version == "" {
		t.Fatal("expected non-empty Version")
	}
}
