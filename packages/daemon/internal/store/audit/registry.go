// Package audit implements the typed-payload registry for the
// unified audit log (#182, D6).
//
// Every audit-worthy event (admin action, certificate lifecycle,
// raft state change, …) registers a Schema describing its
// discriminator, Go struct, and optional redactor. Emitters call
// Marshal(payload) to produce the (schema, json) pair that lands
// in the audit_log table's payload_schema + payload columns. The
// admin renderer dispatches on the discriminator at read time.
//
// Discriminator format: `<namespace>.<action>.v<n>`
//
// Examples:
//
//	config.route_upserted.v1
//	cert.lifecycle_event.v1
//	raft.leader_change.v1
//	auth.role_escalation_rejected.v1
//
// The .v<n> suffix lets us rev individual payload shapes without
// table-wide migrations. New consumers must accept any version
// they're prepared to render and ignore the rest.
package audit

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
)

// Sentinel errors. Wrap with errors.Is to distinguish lookup vs.
// validation vs. encoding failures.
var (
	// ErrUnknownSchema is returned by Unmarshal when no schema is
	// registered under the discriminator. Callers should fall
	// back to displaying the raw payload JSON.
	ErrUnknownSchema = errors.New("audit: unknown payload schema")

	// ErrInvalidDiscriminator is returned when a discriminator
	// fails the format check (`<ns>.<action>.v<n>` with non-empty
	// segments, lowercase, alnum + underscore).
	ErrInvalidDiscriminator = errors.New("audit: invalid discriminator format")
)

// Payload is the marker interface every typed audit payload
// implements. Types that satisfy Payload return their own
// discriminator so the marshalling step doesn't need separate
// per-type plumbing.
//
// Implementations should be JSON-marshallable (encoding/json
// rules apply). The struct's field names are part of the
// discriminator's contract — renaming a field is a backward-
// incompatible change that requires bumping the version.
type Payload interface {
	// AuditSchema returns the discriminator for this payload
	// type. Must be a constant per Go type.
	AuditSchema() string
}

// Schema describes a registered payload type.
type Schema struct {
	// Discriminator is the fully-qualified schema name —
	// e.g. "config.route_upserted.v1".
	Discriminator string

	// New returns a fresh empty value of the registered type.
	// Used by Unmarshal to produce a typed receiver before
	// json.Unmarshal fills it in.
	New func() Payload

	// Redactor, when non-nil, is invoked on the payload before
	// it lands in the audit_log table. Implementations should
	// modify in place; returning a non-nil error rejects the
	// audit insert (caller must handle — typically by logging
	// and skipping the audit entry, since aborting the
	// triggering action over an audit redaction failure is
	// usually wrong).
	Redactor func(Payload) error
}

// Registry holds the discriminator → Schema mapping. Safe for
// concurrent use; registrations typically happen at init time.
type Registry struct {
	mu      sync.RWMutex
	schemas map[string]Schema
}

// NewRegistry constructs an empty Registry.
func NewRegistry() *Registry {
	return &Registry{schemas: make(map[string]Schema)}
}

// Register installs a Schema. Duplicate registrations replace the
// previous binding (last-writer-wins) — this is a feature for
// tests + plugins that want to override defaults; production
// callers shouldn't rely on it. Returns the previous schema, if any.
func (r *Registry) Register(s Schema) (Schema, error) {
	if !ValidateDiscriminator(s.Discriminator) {
		return Schema{}, fmt.Errorf("%w: %q", ErrInvalidDiscriminator, s.Discriminator)
	}
	if s.New == nil {
		return Schema{}, fmt.Errorf("audit: schema %q has nil New constructor", s.Discriminator)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	prev := r.schemas[s.Discriminator]
	r.schemas[s.Discriminator] = s
	return prev, nil
}

// Lookup returns the Schema under the discriminator, or
// ErrUnknownSchema when none is registered.
func (r *Registry) Lookup(discriminator string) (Schema, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	s, ok := r.schemas[discriminator]
	if !ok {
		return Schema{}, fmt.Errorf("%w: %q", ErrUnknownSchema, discriminator)
	}
	return s, nil
}

// Marshal serialises p into the (discriminator, JSON) pair the
// audit_log table stores. If a Redactor is registered for p's
// schema, it runs first (in place); a redactor error aborts the
// marshal and is returned wrapped.
func (r *Registry) Marshal(p Payload) (discriminator string, body []byte, err error) {
	if p == nil {
		return "", nil, errors.New("audit: cannot marshal nil payload")
	}
	disc := p.AuditSchema()
	schema, lookupErr := r.Lookup(disc)
	if lookupErr == nil && schema.Redactor != nil {
		if redactErr := schema.Redactor(p); redactErr != nil {
			return "", nil, fmt.Errorf("audit: redactor for %q failed: %w", disc, redactErr)
		}
	}
	body, err = json.Marshal(p)
	if err != nil {
		return "", nil, fmt.Errorf("audit: marshal %q: %w", disc, err)
	}
	return disc, body, nil
}

// Unmarshal reverses Marshal: builds a typed Payload from the
// stored (discriminator, body). Returns ErrUnknownSchema when no
// schema is registered — callers should treat the body as raw
// JSON in that case.
func (r *Registry) Unmarshal(discriminator string, body []byte) (Payload, error) {
	schema, err := r.Lookup(discriminator)
	if err != nil {
		return nil, err
	}
	p := schema.New()
	if err := json.Unmarshal(body, p); err != nil {
		return nil, fmt.Errorf("audit: unmarshal %q: %w", discriminator, err)
	}
	return p, nil
}

// All returns the full set of registered schemas, sorted by
// discriminator. Useful for the admin's schema-list endpoint and
// for tests asserting registration completeness.
func (r *Registry) All() []Schema {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]Schema, 0, len(r.schemas))
	for _, s := range r.schemas {
		out = append(out, s)
	}
	// Stable order helps tests and admin UI; sort by
	// discriminator since that's the only naturally-orderable
	// field.
	sortSchemas(out)
	return out
}

// ValidateDiscriminator checks the discriminator format. Rules:
//
//   - lower-case ASCII only
//   - exactly three dot-separated segments: namespace, action, version
//   - namespace + action: alpha + digits + underscore, leading alpha
//   - version: literal "v" followed by one or more digits
func ValidateDiscriminator(d string) bool {
	parts := strings.Split(d, ".")
	if len(parts) != 3 {
		return false
	}
	if !validIdent(parts[0]) || !validIdent(parts[1]) {
		return false
	}
	v := parts[2]
	if len(v) < 2 || v[0] != 'v' {
		return false
	}
	for i := 1; i < len(v); i++ {
		if v[i] < '0' || v[i] > '9' {
			return false
		}
	}
	return true
}

func validIdent(s string) bool {
	if s == "" {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= 'a' && c <= 'z':
		case i > 0 && (c >= '0' && c <= '9' || c == '_'):
		default:
			return false
		}
	}
	return true
}

func sortSchemas(s []Schema) {
	// Bubble sort is plenty for the small registry size we
	// expect (~20 schemas). Avoids an extra import.
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && s[j].Discriminator < s[j-1].Discriminator; j-- {
			s[j], s[j-1] = s[j-1], s[j]
		}
	}
}
