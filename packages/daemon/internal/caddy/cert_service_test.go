package caddy

import (
	"context"
	"strings"
	"testing"
)

func TestStubCertService_ListReturnsEmpty(t *testing.T) {
	s := NewStubCertService()
	certs, err := s.ListCertificates(context.Background())
	if err != nil {
		t.Fatalf("ListCertificates: %v", err)
	}
	if certs == nil {
		t.Error("expected empty slice, got nil")
	}
	if len(certs) != 0 {
		t.Errorf("expected 0 certs, got %d", len(certs))
	}
}

func TestStubCertService_RenewReturnsNote(t *testing.T) {
	s := NewStubCertService()
	res, err := s.RenewCertificate(context.Background(), "any-id")
	if err != nil {
		t.Fatalf("RenewCertificate: %v", err)
	}
	if !strings.Contains(res.Note, "stage-1") {
		t.Errorf("expected stage-1 note, got %q", res.Note)
	}
	if res.StartedAt.IsZero() {
		t.Error("expected non-zero StartedAt")
	}
}

func TestStubCertService_RevokeReturnsNote(t *testing.T) {
	s := NewStubCertService()
	res, err := s.RevokeCertificate(context.Background(), "any-id")
	if err != nil {
		t.Fatalf("RevokeCertificate: %v", err)
	}
	if !strings.Contains(res.Note, "Revocation is not implemented") {
		t.Errorf("expected revocation note, got %q", res.Note)
	}
}
