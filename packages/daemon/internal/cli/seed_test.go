package cli

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

// TestSandboxSeedFileParses confirms the canonical sandbox seed.yaml
// round-trips through the SeedFile struct without errors and that
// every stage-2 entity block decodes to non-zero counts.
//
// This catches schema/yaml-tag drift that would otherwise only show
// up at sandbox-startup time.
func TestSandboxSeedFileParses(t *testing.T) {
	raw, err := os.ReadFile("../../../../sandbox/config/seed.yaml")
	if err != nil {
		t.Skipf("sandbox seed not found (running outside repo?): %v", err)
	}

	// envSubstitute mirrors what the runtime does.
	raw = envSubstitute(raw)

	var seed SeedFile
	if err := yaml.Unmarshal(raw, &seed); err != nil {
		t.Fatalf("unmarshal seed.yaml: %v", err)
	}

	// Spot-check every block landed something.
	checks := []struct {
		name string
		got  int
		min  int
	}{
		{"roles", len(seed.Roles), 1},
		{"services", len(seed.Services), 3},
		{"policies", len(seed.Policies), 3},
		{"routes", len(seed.Routes), 5},
		{"users", len(seed.Users), 4},
		{"api_keys", len(seed.APIKeys), 1},
		{"tenants", len(seed.Tenants), 1},
		{"memberships", len(seed.Memberships), 1},
		{"sites", len(seed.Sites), 1},
		{"middlewares", len(seed.Middlewares), 1},
		{"dashboards", len(seed.Dashboards), 1},
		{"ai_providers", len(seed.AIProviders), 1},
		{"ai_agents", len(seed.AIAgents), 1},
		{"ai_tools", len(seed.AITools), 1},
		{"ai_tool_bindings", len(seed.AIToolBindings), 1},
		{"ai_rate_limits", len(seed.AIRateLimits), 1},
		{"mcp_servers", len(seed.MCPServers), 1},
		{"notification_channels", len(seed.NotificationChannels), 1},
		{"notification_routing", len(seed.NotificationRouting), 1},
		{"plugins", len(seed.Plugins), 1},
		{"plugin_signers", len(seed.PluginSigners), 1},
		{"cert_authorities", len(seed.CertAuthorities), 1},
		{"cert_enrollments", len(seed.CertEnrollments), 1},
		{"tls_certificates", len(seed.TLSCertificates), 1},
		{"webhook_endpoints", len(seed.WebhookEndpoints), 1},
	}
	for _, c := range checks {
		if c.got < c.min {
			t.Errorf("seed.yaml: %s = %d, want >= %d", c.name, c.got, c.min)
		}
	}

	// Singletons should be present.
	if seed.TLSConfig == nil {
		t.Error("tls_config should be present")
	}
	if seed.NetworkConfig == nil {
		t.Error("network_config should be present")
	}
	if seed.AuthPolicy == nil {
		t.Error("auth_policy should be present")
	}
	if seed.ObservabilityConfig == nil {
		t.Error("observability_config should be present")
	}
	if seed.AuditRetentionConfig == nil {
		t.Error("audit_retention should be present")
	}
	if seed.NotificationConfig == nil {
		t.Error("notification_config should be present")
	}
}

func TestLoadSeedFromDir(t *testing.T) {
	dir := t.TempDir()

	// Two YAMLs that should merge: one with services, one with users + tls_config.
	if err := os.WriteFile(filepath.Join(dir, "01-services.yaml"), []byte(`
services:
  - name: a
  - name: b
`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "02-users.yaml"), []byte(`
users:
  - username: alice
    password: Secret1!
tls_config:
  min_protocol: TLS_1_3
`), 0o644); err != nil {
		t.Fatal(err)
	}

	merged, err := loadSeedFromDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(merged.Services) != 2 {
		t.Errorf("services = %d, want 2", len(merged.Services))
	}
	if len(merged.Users) != 1 {
		t.Errorf("users = %d, want 1", len(merged.Users))
	}
	if merged.TLSConfig == nil {
		t.Error("tls_config not loaded")
	}
}

func TestLoadSeedFromDirPointerLWW(t *testing.T) {
	dir := t.TempDir()

	// First file sets tls_config with min_protocol TLS_1_2.
	if err := os.WriteFile(filepath.Join(dir, "01-tls.yaml"), []byte(`
tls_config:
  min_protocol: TLS_1_2
`), 0o644); err != nil {
		t.Fatal(err)
	}
	// Second file overrides with TLS_1_3 (last-write-wins).
	if err := os.WriteFile(filepath.Join(dir, "02-tls-override.yaml"), []byte(`
tls_config:
  min_protocol: TLS_1_3
`), 0o644); err != nil {
		t.Fatal(err)
	}

	merged, err := loadSeedFromDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if merged.TLSConfig == nil {
		t.Fatal("tls_config is nil")
	}
	if merged.TLSConfig.MinProtocol != "TLS_1_3" {
		t.Errorf("tls_config.min_protocol = %q, want TLS_1_3", merged.TLSConfig.MinProtocol)
	}
}

func TestSeedFileAndDirMutuallyExclusive(t *testing.T) {
	cmd := newSeedCmd()
	cmd.SetArgs([]string{"--file", "x.yaml", "--dir", "y"})
	err := cmd.Execute()
	if err == nil || !strings.Contains(err.Error(), "exactly one of --file or --dir") {
		t.Errorf("expected mutual-exclusion error, got: %v", err)
	}
}

func TestSeedNeitherFileNorDir(t *testing.T) {
	cmd := newSeedCmd()
	cmd.SetArgs([]string{"--target", "http://localhost:7778"})
	err := cmd.Execute()
	if err == nil || !strings.Contains(err.Error(), "exactly one of --file or --dir") {
		t.Errorf("expected at-least-one error, got: %v", err)
	}
}
