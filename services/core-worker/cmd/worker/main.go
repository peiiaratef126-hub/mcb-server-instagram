package main

import (
	"fmt"
	"log"
)

const (
	ServiceName = "core-worker"
	Version     = "0.1.0-alpha.0"
)

func main() {
	log.Printf("Starting %s v%s...", ServiceName, Version)
	fmt.Printf("%s initialized successfully.\n", ServiceName)
}
