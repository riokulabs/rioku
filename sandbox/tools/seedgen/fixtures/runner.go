package fixtures

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math/rand/v2"
	"net/http"
	"sort"
	"sync"
)

// RunnerConfig holds the configuration for a fixture Runner.
type RunnerConfig struct {
	APIBase  string
	APIToken string
	Tenant   string
	Mode     string
	Seed     int64
}

// Fixture describes a single seed fixture with a name, ordering priority, and run function.
type Fixture struct {
	Name  string
	Order int
	Run   func(r *Runner) error
}

// Runner executes registered fixtures against the daemon REST API.
type Runner struct {
	cfg  RunnerConfig
	rng  *rand.Rand
	http *http.Client
}

var (
	registry   = []Fixture{}
	registryMu sync.Mutex
)

// Register adds a Fixture to the global registry. Typically called from init().
func Register(f Fixture) {
	registryMu.Lock()
	defer registryMu.Unlock()
	registry = append(registry, f)
}

// NewRunner creates a Runner with a deterministic PRNG seeded from cfg.Seed.
func NewRunner(cfg RunnerConfig) *Runner {
	return &Runner{
		cfg:  cfg,
		rng:  rand.New(rand.NewPCG(uint64(cfg.Seed), uint64(cfg.Seed)+1)),
		http: &http.Client{},
	}
}

// Mode returns the seeding mode ("lean" or "rich").
func (r *Runner) Mode() string { return r.cfg.Mode }

// Tenant returns the tenant slug being seeded.
func (r *Runner) Tenant() string { return r.cfg.Tenant }

// Rand returns the deterministic PRNG for use by fixtures.
func (r *Runner) Rand() *rand.Rand { return r.rng }

// RunAll executes all registered fixtures in Order-ascending order.
func (r *Runner) RunAll() error {
	fixtures := append([]Fixture(nil), registry...)
	sort.Slice(fixtures, func(i, j int) bool { return fixtures[i].Order < fixtures[j].Order })
	for _, f := range fixtures {
		fmt.Printf("[seedgen] %s ...\n", f.Name)
		if err := f.Run(r); err != nil {
			return fmt.Errorf("%s: %w", f.Name, err)
		}
	}
	return nil
}

// Post sends a JSON POST to the given API path relative to APIBase.
func (r *Runner) Post(path string, body any) (*http.Response, error) {
	return r.do("POST", path, body)
}

// Put sends a JSON PUT to the given API path relative to APIBase.
func (r *Runner) Put(path string, body any) (*http.Response, error) {
	return r.do("PUT", path, body)
}

func (r *Runner) do(method, path string, body any) (*http.Response, error) {
	var buf io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		buf = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, r.cfg.APIBase+path, buf)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if r.cfg.APIToken != "" {
		req.Header.Set("Authorization", "Bearer "+r.cfg.APIToken)
	}
	return r.http.Do(req)
}
