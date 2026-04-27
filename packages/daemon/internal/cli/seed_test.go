package cli

import (
	"os"
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
