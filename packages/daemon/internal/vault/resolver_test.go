package vault

import (
	"context"
	"errors"
	"testing"
)

// fakeBackend is a tiny in-memory backend used to keep tests
// independent of process state and disk IO.
type fakeBackend struct {
	name string
	sync bool
	data map[string]string
	err  error
}

func (f *fakeBackend) Name() string { return f.name }
func (f *fakeBackend) Sync() bool   { return f.sync }
func (f *fakeBackend) Resolve(_ context.Context, resource string) (string, error) {
	if f.err != nil {
		return "", f.err
	}
	v, ok := f.data[resource]
	if !ok {
		return "", ErrResolveFailed
	}
	return v, nil
}

func TestResolver_RegisterAndDispatch(t *testing.T) {
	r := NewResolver()
	r.Register(&fakeBackend{name: "fake", sync: true, data: map[string]string{"key": "secret"}})

	got, err := r.Resolve(context.Background(), Ref{Backend: "fake", Resource: "key"})
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if got != "secret" {
		t.Fatalf("got %q, want %q", got, "secret")
	}
}

func TestResolver_UnknownBackend(t *testing.T) {
	r := NewResolver()
	_, err := r.Resolve(context.Background(), Ref{Backend: "missing", Resource: "key"})
	if !errors.Is(err, ErrUnknownBackend) {
		t.Fatalf("err = %v, want wrap ErrUnknownBackend", err)
	}
}

func TestResolver_RegisterReplaces(t *testing.T) {
	r := NewResolver()
	first := &fakeBackend{name: "fake", data: map[string]string{"a": "1"}}
	second := &fakeBackend{name: "fake", data: map[string]string{"a": "2"}}
	r.Register(first)
	prev := r.Register(second)
	if prev != first {
		t.Fatalf("Register did not return previous backend")
	}
	got, err := r.Resolve(context.Background(), Ref{Backend: "fake", Resource: "a"})
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if got != "2" {
		t.Fatalf("got %q, want %q (last writer should win)", got, "2")
	}
}

func TestResolver_ResolveString_LiteralPassthrough(t *testing.T) {
	r := NewResolver()
	got, err := r.ResolveString(context.Background(), "literal-secret")
	if err != nil {
		t.Fatalf("ResolveString literal: %v", err)
	}
	if got != "literal-secret" {
		t.Fatalf("got %q, want literal-secret", got)
	}
}

func TestResolver_ResolveString_DispatchesReference(t *testing.T) {
	r := NewResolver()
	r.Register(&fakeBackend{name: "fake", data: map[string]string{"k": "v"}})
	got, err := r.ResolveString(context.Background(), "{vault://fake/k}")
	if err != nil {
		t.Fatalf("ResolveString ref: %v", err)
	}
	if got != "v" {
		t.Fatalf("got %q, want v", got)
	}
}

func TestResolver_ResolveAll_AtomicityOnFailure(t *testing.T) {
	r := NewResolver()
	r.Register(&fakeBackend{name: "fake", data: map[string]string{"good": "ok"}})

	out, err := r.ResolveAll(context.Background(), map[string]string{
		"a": "{vault://fake/good}",
		"b": "{vault://fake/missing}",
	})
	if err == nil {
		t.Fatalf("expected error on partial resolve failure")
	}
	if out != nil {
		t.Fatalf("expected nil map on partial failure, got %v", out)
	}
}

func TestResolver_ResolveAll_AllLiteralsAndRefs(t *testing.T) {
	r := NewResolver()
	r.Register(&fakeBackend{name: "fake", data: map[string]string{"k": "v"}})

	out, err := r.ResolveAll(context.Background(), map[string]string{
		"literal":   "abc",
		"reference": "{vault://fake/k}",
	})
	if err != nil {
		t.Fatalf("ResolveAll: %v", err)
	}
	if out["literal"] != "abc" || out["reference"] != "v" {
		t.Fatalf("unexpected output: %v", out)
	}
}

func TestResolver_RegisterNilPanics(t *testing.T) {
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("Register(nil) did not panic")
		}
	}()
	NewResolver().Register(nil)
}

func TestResolver_Preflight_LiteralPasses(t *testing.T) {
	r := NewResolver()
	if err := r.Preflight(context.Background(), "plaintext-secret"); err != nil {
		t.Errorf("Preflight literal: %v", err)
	}
}

func TestResolver_Preflight_ResolvableRefPasses(t *testing.T) {
	r := NewResolver()
	r.Register(&fakeBackend{name: "fake", sync: true, data: map[string]string{"k": "v"}})

	if err := r.Preflight(context.Background(), "{vault://fake/k}"); err != nil {
		t.Errorf("Preflight resolvable: %v", err)
	}
}

func TestResolver_Preflight_BadRefRejected(t *testing.T) {
	r := NewResolver()
	r.Register(&fakeBackend{name: "fake", sync: true, data: map[string]string{}})

	err := r.Preflight(context.Background(), "{vault://fake/missing}")
	if err == nil {
		t.Fatal("Preflight on unresolvable ref returned nil")
	}
	if !errors.Is(err, ErrResolveFailed) {
		t.Errorf("err = %v, want wrap ErrResolveFailed", err)
	}
}

func TestResolver_Preflight_NilResolverAcceptsSyntacticOnly(t *testing.T) {
	var r *Resolver
	// Literal: pass through.
	if err := r.Preflight(context.Background(), "literal"); err != nil {
		t.Errorf("nil Resolver literal: %v", err)
	}
	// Well-formed ref: pass through (resolution skipped).
	if err := r.Preflight(context.Background(), "{vault://env/X}"); err != nil {
		t.Errorf("nil Resolver well-formed ref: %v", err)
	}
}

func TestResolver_Preflight_MalformedRefRejected(t *testing.T) {
	r := NewResolver()
	// Looks like a ref ({vault://...}) but missing the resource.
	err := r.Preflight(context.Background(), "{vault://}")
	if err == nil {
		t.Fatal("Preflight on malformed ref returned nil")
	}
}
