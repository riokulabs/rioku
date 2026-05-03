// Package registry vendors LiteLLM's model_prices_and_context_window.json
// (Sprint 5 Phase 1, #166) and exposes a typed lookup API for the
// AI gateway's cost calculator + budget enforcement + admin views.
//
// Per the source spec the file is vendored verbatim — operators can
// replace it via a weekly upstream-sync workflow (#166 Phase 1c)
// without daemon code changes. The parser is tolerant: unknown
// fields are logged at debug level so future upstream additions
// don't break the loader.
//
// A Rioku overlay (`rioku_overrides.json`, #166 Phase 1b) merges on
// top of the upstream registry at init time. Overlay entries:
//   - shadow upstream entries to apply Rioku-specific markups,
//   - add models the upstream doesn't yet ship (e.g. internal
//     deployments, on-prem),
//   - tag deprecated models so the admin renders a warning.
//
// The registry is read-only after Init. Rebuilding it is a daemon
// restart; the file is small enough (1.4 MB upstream + a few KB of
// overrides) that init time is sub-millisecond.
package registry

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"
)

//go:embed upstream/model_prices_and_context_window.json
var upstreamJSON []byte

// Model is the typed shape of one entry in the LiteLLM JSON. The
// JSON tags match the upstream field names verbatim so unmarshal +
// future overrides ride the same schema.
//
// Pointer fields distinguish "absent" from "zero" — important for
// per-token costs where 0 is a legitimate value (free tiers) and
// for the cache cost fields where absence means "model doesn't
// support prompt caching."
type Model struct {
	// ID is the upstream model identifier (e.g. "gpt-4o").
	// Populated from the JSON object's key, NOT from the value.
	ID string `json:"-"`

	MaxTokens       *int `json:"max_tokens,omitempty"`
	MaxInputTokens  *int `json:"max_input_tokens,omitempty"`
	MaxOutputTokens *int `json:"max_output_tokens,omitempty"`

	InputCostPerToken           *float64 `json:"input_cost_per_token,omitempty"`
	OutputCostPerToken          *float64 `json:"output_cost_per_token,omitempty"`
	CacheCreationInputTokenCost *float64 `json:"cache_creation_input_token_cost,omitempty"`
	CacheReadInputTokenCost     *float64 `json:"cache_read_input_token_cost,omitempty"`

	// LiteLLMProvider is the upstream family — "openai",
	// "anthropic", "vertex_ai", "ollama", "custom", etc. Used by
	// the AI router's per-provider strategy slots and by the
	// admin's provider grouping.
	LiteLLMProvider string `json:"litellm_provider,omitempty"`

	// Mode is "chat", "completion", "embedding", "image_generation".
	Mode string `json:"mode,omitempty"`

	SupportsFunctionCalling bool `json:"supports_function_calling,omitempty"`
	SupportsVision          bool `json:"supports_vision,omitempty"`
	SupportsPromptCaching   bool `json:"supports_prompt_caching,omitempty"`

	// RiokuOverlay marks models that came from rioku_overrides.json
	// rather than the upstream LiteLLM file. Useful for the admin
	// renderer to flag operator-defined entries vs vendored ones.
	RiokuOverlay bool `json:"-"`

	// Deprecated, when non-empty, is the operator-supplied note
	// shown in admin UI warning that this model shouldn't be
	// picked for new traffic. Defaults to empty for upstream
	// entries; populated via the overlay.
	Deprecated string `json:"deprecated,omitempty"`
}

// Registry holds the merged upstream+overlay model set.
type Registry struct {
	mu     sync.RWMutex
	models map[string]*Model
}

// New builds a Registry from the embedded upstream JSON. Returns
// an error when the embedded JSON is malformed (which would mean
// the build is broken; the operator can't recover at runtime).
func New() (*Registry, error) {
	r := &Registry{models: make(map[string]*Model)}
	if err := r.loadJSON(upstreamJSON, false); err != nil {
		return nil, fmt.Errorf("registry: load upstream: %w", err)
	}
	return r, nil
}

// LoadOverlay merges a Rioku-overlay JSON document on top of the
// upstream registry. The overlay's keys match the upstream schema;
// any field set in the overlay shadows the upstream value, and
// any new key adds a model. Overlay-introduced models carry
// RiokuOverlay=true.
//
// Operators ship the overlay as a config file path or as inline
// bytes; either way it's loaded once at init and not reloaded
// until daemon restart.
func (r *Registry) LoadOverlay(jsonBytes []byte) error {
	if len(jsonBytes) == 0 {
		return nil
	}
	return r.loadJSON(jsonBytes, true)
}

func (r *Registry) loadJSON(payload []byte, overlay bool) error {
	// LiteLLM's file has a top-level "_comment" / "sample_spec" key
	// that doesn't match the model schema. The tolerant parse path
	// uses a generic map first, then unmarshals each value into
	// the typed Model struct, skipping non-object entries.
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(payload, &raw); err != nil {
		return fmt.Errorf("parse json: %w", err)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	for id, body := range raw {
		// Skip metadata keys — they all start with "_" by
		// LiteLLM convention.
		if strings.HasPrefix(id, "_") || id == "sample_spec" {
			continue
		}
		var m Model
		if err := json.Unmarshal(body, &m); err != nil {
			// Tolerant: log via debug elsewhere; here we
			// just skip the bad entry rather than fail the
			// whole load.
			continue
		}
		m.ID = id
		m.RiokuOverlay = overlay
		r.models[id] = &m
	}
	return nil
}

// Get returns the model entry for id, or nil + ErrModelNotFound.
func (r *Registry) Get(id string) (*Model, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	m, ok := r.models[id]
	if !ok {
		return nil, fmt.Errorf("%w: %q", ErrModelNotFound, id)
	}
	// Defensive copy so the caller can't mutate the registry
	// state through the pointer.
	cp := *m
	return &cp, nil
}

// Lookup is the panicking-on-miss variant of Get for code paths
// that have already validated the model id.
func (r *Registry) Lookup(id string) *Model {
	m, err := r.Get(id)
	if err != nil {
		return nil
	}
	return m
}

// All returns every registered model, sorted by id. Useful for
// the admin's model picker + dropdowns.
func (r *Registry) All() []*Model {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]*Model, 0, len(r.models))
	for _, m := range r.models {
		cp := *m
		out = append(out, &cp)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// ByProvider returns models whose LiteLLMProvider matches name,
// sorted by id. Empty name returns nil.
func (r *Registry) ByProvider(name string) []*Model {
	if name == "" {
		return nil
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	var out []*Model
	for _, m := range r.models {
		if m.LiteLLMProvider == name {
			cp := *m
			out = append(out, &cp)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// Count returns the number of registered models. Useful for
// startup telemetry — admins should see a count > 1000 once the
// full LiteLLM file lands.
func (r *Registry) Count() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.models)
}

// ErrModelNotFound is the sentinel returned by Get when the model
// id isn't registered. Callers map this to a 404 / ErrInvalid
// response.
var ErrModelNotFound = fmt.Errorf("registry: model not found")
