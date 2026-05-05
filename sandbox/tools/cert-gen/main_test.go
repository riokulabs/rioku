package main

import (
	"crypto/x509"
	"encoding/pem"
	"os"
	"path/filepath"
	"testing"
)

func TestGenerateCAAndLeaf(t *testing.T) {
	dir := t.TempDir()
	cfg := Config{
		OutDir:        dir,
		CACommonName:  "Rioku Sandbox CA",
		LeafSubjects:  []string{"localhost", "*.localhost", "*.tenant.localhost"},
		ValidityHours: 8760,
	}
	if err := Run(cfg); err != nil {
		t.Fatalf("Run failed: %v", err)
	}

	caBytes, err := os.ReadFile(filepath.Join(dir, "ca.pem"))
	if err != nil {
		t.Fatalf("missing ca.pem: %v", err)
	}
	caBlock, _ := pem.Decode(caBytes)
	if caBlock == nil {
		t.Fatal("ca.pem not PEM-encoded")
	}
	caCert, err := x509.ParseCertificate(caBlock.Bytes)
	if err != nil {
		t.Fatalf("parse CA: %v", err)
	}
	if !caCert.IsCA {
		t.Fatal("CA cert IsCA = false")
	}
	if caCert.Subject.CommonName != "Rioku Sandbox CA" {
		t.Errorf("CA CommonName = %q, want %q", caCert.Subject.CommonName, "Rioku Sandbox CA")
	}

	leafBytes, err := os.ReadFile(filepath.Join(dir, "leaf.pem"))
	if err != nil {
		t.Fatalf("missing leaf.pem: %v", err)
	}
	leafBlock, _ := pem.Decode(leafBytes)
	leafCert, err := x509.ParseCertificate(leafBlock.Bytes)
	if err != nil {
		t.Fatalf("parse leaf: %v", err)
	}
	if leafCert.IsCA {
		t.Error("leaf cert IsCA = true (should be false)")
	}

	gotNames := make(map[string]bool)
	for _, n := range leafCert.DNSNames {
		gotNames[n] = true
	}
	for _, want := range cfg.LeafSubjects {
		if !gotNames[want] {
			t.Errorf("leaf cert missing DNS name %q (got %v)", want, leafCert.DNSNames)
		}
	}

	roots := x509.NewCertPool()
	roots.AddCert(caCert)
	if _, err := leafCert.Verify(x509.VerifyOptions{
		Roots:   roots,
		DNSName: "localhost",
	}); err != nil {
		t.Fatalf("leaf does not verify against CA: %v", err)
	}

	for _, fn := range []string{"ca-key.pem", "leaf-key.pem"} {
		if _, err := os.Stat(filepath.Join(dir, fn)); err != nil {
			t.Errorf("missing %s: %v", fn, err)
		}
	}
}

func TestRefuseOverwriteWithoutForce(t *testing.T) {
	dir := t.TempDir()
	cfg := Config{
		OutDir:        dir,
		CACommonName:  "test",
		LeafSubjects:  []string{"localhost"},
		ValidityHours: 24,
	}
	if err := Run(cfg); err != nil {
		t.Fatal(err)
	}
	if err := Run(cfg); err == nil {
		t.Fatal("expected error on second run without Force")
	}
	cfg.Force = true
	if err := Run(cfg); err != nil {
		t.Fatalf("force run failed: %v", err)
	}
}
