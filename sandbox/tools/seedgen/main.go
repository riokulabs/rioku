package main

import (
	"flag"
	"fmt"
	"log"
	"os"

	"github.com/riokulabs/rioku/sandbox/tools/seedgen/fixtures"
)

// Config holds seedgen runtime configuration.
type Config struct {
	APIBase  string
	APIToken string
	Tenant   string
	Mode     string
	Seed     int64
}

func main() {
	apiBase := flag.String("api-base", "http://localhost:7778/api/v1", "daemon REST base URL")
	apiToken := flag.String("api-token", os.Getenv("SANDBOX_ROOT_TOKEN"), "bearer token for seeding")
	tenant := flag.String("tenant", "acme", "tenant slug to seed")
	mode := flag.String("mode", "rich", "lean | rich")
	seed := flag.Int64("seed", 42, "deterministic random seed")
	flag.Parse()

	cfg := Config{*apiBase, *apiToken, *tenant, *mode, *seed}
	if err := run(cfg); err != nil {
		log.Fatalf("seedgen: %v", err)
	}
	fmt.Println("seedgen complete")
}

func run(cfg Config) error {
	r := fixtures.NewRunner(fixtures.RunnerConfig{
		APIBase:  cfg.APIBase,
		APIToken: cfg.APIToken,
		Tenant:   cfg.Tenant,
		Mode:     cfg.Mode,
		Seed:     cfg.Seed,
	})
	return r.RunAll()
}
