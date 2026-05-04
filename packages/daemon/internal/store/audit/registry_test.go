package audit

import (
	"errors"
	"strings"
	"testing"
)

func TestValidateDiscriminator(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		// Valid
		{"config.route_upserted.v1", true},
		{"cert.lifecycle_event.v1", true},
		{"raft.leader_change.v2", true},
		{"auth.role_escalation_rejected.v1", true},
		{"a.b.v999", true},

		// Invalid — wrong segment count
		{"config.route_upserted", false},
		{"config.route_upserted.v1.extra", false},
		{"single", false},
		{"", false},

		// Invalid — bad version
		{"config.route_upserted.1", false},
		{"config.route_upserted.v", false},
		{"config.route_upserted.va", false},
		{"config.route_upserted.v1a", false},
		{"config.route_upserted.V1", false},

		// Invalid — bad ident
		{"Config.route_upserted.v1", false},
		{"config.RouteUpserted.v1", false},
		{"1config.route.v1", false},
		{"config..v1", false},
		{".route.v1", false},
		{"config.route-upserted.v1", false},
	}
	for _, tc := range cases {
		if got := ValidateDiscriminator(tc.in); got != tc.want {
			t.Errorf("ValidateDiscriminator(%q) = %v, want %v", tc.in, got, tc.want)
		}
	}
}

func TestRegistry_RegisterAndLookup(t *testing.T) {
	r := NewRegistry()
	s := Schema{
		Discriminator: "test.thing.v1",
		New:           func() Payload { return &CertLifecycleEvent{} },
	}
	if _, err := r.Register(s); err != nil {
		t.Fatalf("Register: %v", err)
	}
	got, err := r.Lookup("test.thing.v1")
	if err != nil {
		t.Fatalf("Lookup: %v", err)
	}
	if got.Discriminator != "test.thing.v1" {
		t.Fatalf("got %q, want test.thing.v1", got.Discriminator)
	}
}

func TestRegistry_RejectsInvalidDiscriminator(t *testing.T) {
	r := NewRegistry()
	_, err := r.Register(Schema{
		Discriminator: "Invalid",
		New:           func() Payload { return &CertLifecycleEvent{} },
	})
	if !errors.Is(err, ErrInvalidDiscriminator) {
		t.Fatalf("err = %v, want wrap ErrInvalidDiscriminator", err)
	}
}

func TestRegistry_RejectsNilNew(t *testing.T) {
	r := NewRegistry()
	_, err := r.Register(Schema{
		Discriminator: "test.thing.v1",
		New:           nil,
	})
	if err == nil {
		t.Fatal("expected error for nil New constructor")
	}
}

func TestRegistry_LookupUnknownReturnsSentinel(t *testing.T) {
	r := NewRegistry()
	_, err := r.Lookup("missing.thing.v1")
	if !errors.Is(err, ErrUnknownSchema) {
		t.Fatalf("err = %v, want wrap ErrUnknownSchema", err)
	}
}

func TestRegistry_RegisterReplaces(t *testing.T) {
	r := NewRegistry()
	first := Schema{
		Discriminator: "test.thing.v1",
		New:           func() Payload { return &CertLifecycleEvent{} },
	}
	second := Schema{
		Discriminator: "test.thing.v1",
		New:           func() Payload { return &RaftLeaderChange{} },
	}
	if _, err := r.Register(first); err != nil {
		t.Fatalf("Register first: %v", err)
	}
	prev, err := r.Register(second)
	if err != nil {
		t.Fatalf("Register second: %v", err)
	}
	if prev.Discriminator != "test.thing.v1" {
		t.Fatalf("prev = %q, want test.thing.v1", prev.Discriminator)
	}
}

func TestRegistry_MarshalRoundTrip(t *testing.T) {
	r := NewRegistry()
	if _, err := r.Register(Schema{
		Discriminator: "cert.lifecycle_event.v1",
		New:           func() Payload { return &CertLifecycleEvent{} },
	}); err != nil {
		t.Fatal(err)
	}
	in := &CertLifecycleEvent{
		Action:    "issued",
		Issuer:    "letsencrypt",
		SubjectCN: "example.com",
	}
	disc, body, err := r.Marshal(in)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	if disc != "cert.lifecycle_event.v1" {
		t.Fatalf("disc = %q", disc)
	}
	out, err := r.Unmarshal(disc, body)
	if err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	got, ok := out.(*CertLifecycleEvent)
	if !ok {
		t.Fatalf("out not *CertLifecycleEvent: %T", out)
	}
	if got.Action != "issued" || got.Issuer != "letsencrypt" || got.SubjectCN != "example.com" {
		t.Fatalf("round-trip lost fields: %+v", got)
	}
}

func TestRegistry_MarshalNilPayloadFails(t *testing.T) {
	r := NewRegistry()
	if _, _, err := r.Marshal(nil); err == nil {
		t.Fatal("expected error for nil payload")
	}
}

func TestRegistry_RedactorRunsBeforeMarshal(t *testing.T) {
	r := NewRegistry()
	called := 0
	if _, err := r.Register(Schema{
		Discriminator: "cert.lifecycle_event.v1",
		New:           func() Payload { return &CertLifecycleEvent{} },
		Redactor: func(p Payload) error {
			called++
			ev, ok := p.(*CertLifecycleEvent)
			if !ok {
				return errors.New("redactor got wrong type")
			}
			ev.SubjectCN = "[redacted]"
			return nil
		},
	}); err != nil {
		t.Fatal(err)
	}
	in := &CertLifecycleEvent{Action: "issued", SubjectCN: "secret-host.example"}
	_, body, err := r.Marshal(in)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	if called != 1 {
		t.Fatalf("redactor called %d times, want 1", called)
	}
	if !strings.Contains(string(body), "[redacted]") {
		t.Fatalf("redacted value missing from body: %s", body)
	}
	if strings.Contains(string(body), "secret-host.example") {
		t.Fatalf("plaintext SubjectCN leaked: %s", body)
	}
}

func TestRegistry_RedactorErrorAbortsMarshal(t *testing.T) {
	r := NewRegistry()
	if _, err := r.Register(Schema{
		Discriminator: "cert.lifecycle_event.v1",
		New:           func() Payload { return &CertLifecycleEvent{} },
		Redactor:      func(Payload) error { return errors.New("nope") },
	}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := r.Marshal(&CertLifecycleEvent{Action: "issued"}); err == nil {
		t.Fatal("expected error from redactor failure")
	}
}

func TestRegistry_UnmarshalUnknownSchemaReturnsSentinel(t *testing.T) {
	r := NewRegistry()
	_, err := r.Unmarshal("missing.thing.v1", []byte(`{"any":"json"}`))
	if !errors.Is(err, ErrUnknownSchema) {
		t.Fatalf("err = %v, want wrap ErrUnknownSchema", err)
	}
}

func TestRegistry_AllReturnsSorted(t *testing.T) {
	r := NewRegistry()
	for _, d := range []string{"z.a.v1", "a.z.v1", "m.m.v1"} {
		if _, err := r.Register(Schema{
			Discriminator: d,
			New:           func() Payload { return &CertLifecycleEvent{} },
		}); err != nil {
			t.Fatalf("Register %q: %v", d, err)
		}
	}
	got := r.All()
	if len(got) != 3 {
		t.Fatalf("len = %d, want 3", len(got))
	}
	for i := 1; i < len(got); i++ {
		if got[i-1].Discriminator >= got[i].Discriminator {
			t.Fatalf("All() not sorted: %v", got)
		}
	}
}

func TestDefaultRegistry_HasCanonicalSchemas(t *testing.T) {
	want := []string{
		"cert.lifecycle_event.v1",
		"raft.leader_change.v1",
		"auth.role_escalation_rejected.v1",
		"auth.password_reset_by_admin.v1",
	}
	for _, d := range want {
		if _, err := DefaultRegistry.Lookup(d); err != nil {
			t.Errorf("DefaultRegistry missing %q: %v", d, err)
		}
	}
}

func TestPayloads_ImplementInterface(t *testing.T) {
	// Compile-time + run-time check that the canonical types
	// return their declared discriminators.
	cases := []struct {
		p    Payload
		want string
	}{
		{CertLifecycleEvent{}, "cert.lifecycle_event.v1"},
		{RaftLeaderChange{}, "raft.leader_change.v1"},
		{RoleEscalationRejected{}, "auth.role_escalation_rejected.v1"},
		{PasswordResetByAdmin{}, "auth.password_reset_by_admin.v1"},
	}
	for _, tc := range cases {
		if got := tc.p.AuditSchema(); got != tc.want {
			t.Errorf("%T.AuditSchema() = %q, want %q", tc.p, got, tc.want)
		}
	}
}
