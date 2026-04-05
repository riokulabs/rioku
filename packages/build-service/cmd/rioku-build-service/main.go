package main

import (
	"fmt"
	"os"
)

func main() {
	// TODO: Initialize the build service HTTP server.
	// Receives build manifests, runs xcaddy in isolated environments,
	// returns compiled binaries. REST protocol (not gRPC -- external service).
	fmt.Println("rioku-build-service starting...")
	_ = os.Args
}
