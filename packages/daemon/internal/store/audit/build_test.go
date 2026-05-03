package audit

import (
	"encoding/json"
	"errors"
	"testing"
)

func TestBuildEntry_HappyPath(t *testing.T) {
	r := NewRegistry()
	if _, err := r.Register(Schema{
		Discriminator: "cert.lifecycle_event.v1",
		New:           func() Payload { return &CertLifecycleEvent{} },
	}); err != nil {
		t.Fatal(err)
	}

	entry, err := BuildEntry(r, "admin@example.com", "certificate", "cert-123", "issued",
		&CertLifecycleEvent{
			Action:    "issued",
			Issuer:    "letsencrypt",
			SubjectCN: "example.com",
		})
	if err != nil {
		t.Fatalf("BuildEntry: %v", err)
	}
	if entry.GetActor() != "admin@example.com" {
		t.Errorf("Actor = %q", entry.GetActor())
	}
	if entry.GetEntityType() != "certificate" {
		t.Errorf("EntityType = %q", entry.GetEntityType())
	}
	if entry.GetEntityId() != "cert-123" {
		t.Errorf("EntityId = %q", entry.GetEntityId())
	}
	if entry.GetOperation() != "issued" {
		t.Errorf("Operation = %q", entry.GetOperation())
	}
	if entry.GetPayloadSchema() != "cert.lifecycle_event.v1" {
		t.Errorf("PayloadSchema = %q", entry.GetPayloadSchema())
	}
	if entry.GetId() == "" {
		t.Error("Id was not generated")
	}
	if entry.GetOccurredAt() == nil {
		t.Error("OccurredAt was not stamped")
	}

	// Round-trip the payload to confirm fields land.
	var decoded CertLifecycleEvent
	if err := json.Unmarshal([]byte(entry.GetPayload()), &decoded); err != nil {
		t.Fatalf("json.Unmarshal: %v", err)
	}
	if decoded.Action != "issued" || decoded.Issuer != "letsencrypt" || decoded.SubjectCN != "example.com" {
		t.Fatalf("payload round-trip lost fields: %+v", decoded)
	}
}

func TestBuildEntry_NilRegistryRejected(t *testing.T) {
	_, err := BuildEntry(nil, "actor", "type", "id", "op", &CertLifecycleEvent{})
	if err == nil {
		t.Fatal("expected error for nil registry")
	}
}

func TestBuildEntry_NilPayloadRejected(t *testing.T) {
	r := NewRegistry()
	_, err := BuildEntry(r, "actor", "type", "id", "op", nil)
	if err == nil {
		t.Fatal("expected error for nil payload")
	}
}

func TestBuildEntry_UnregisteredPayloadFailsFast(t *testing.T) {
	r := NewRegistry()
	// CertLifecycleEvent is not registered on this fresh registry.
	_, err := BuildEntry(r, "actor", "type", "id", "op", &CertLifecycleEvent{Action: "x"})
	if !errors.Is(err, ErrUnknownSchema) {
		t.Fatalf("err = %v, want wrap ErrUnknownSchema", err)
	}
}

func TestBuildEntry_UsesDefaultRegistryWhenPassedExplicitly(t *testing.T) {
	// DefaultRegistry has cert.lifecycle_event.v1 pre-registered.
	entry, err := BuildEntry(DefaultRegistry, "actor", "certificate", "c1", "renewed",
		&CertLifecycleEvent{Action: "renewed", Issuer: "internal", SubjectCN: "x"})
	if err != nil {
		t.Fatalf("BuildEntry against DefaultRegistry: %v", err)
	}
	if entry.GetPayloadSchema() != "cert.lifecycle_event.v1" {
		t.Errorf("schema = %q", entry.GetPayloadSchema())
	}
}
