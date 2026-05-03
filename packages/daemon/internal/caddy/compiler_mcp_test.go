package caddy

import (
	"encoding/json"
	"strings"
	"testing"
)

// extractAllRoutes returns the entire routes slice (not just the
// first) so MCP route tests can assert on routes added by the
// compiler beyond the snapshot's primary route.
func extractAllRoutes(t *testing.T, data []byte) []map[string]any {
	t.Helper()
	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	rawRoutes := server["routes"].([]any)
	out := make([]map[string]any, len(rawRoutes))
	for i, r := range rawRoutes {
		out[i] = r.(map[string]any)
	}
	return out
}

func TestCompileWithPlugins_MCPRoute_ForwardAuth(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})
	perRoute := PerRoutePlugins{
		MCPRoutes: []MCPRouteCompileConfig{{
			ID:              "mcpr_1",
			TenantID:        "tenant_default",
			Hostname:        "tools.example.com",
			PathPrefix:      "/mcp",
			UpstreamURL:     "https://mcp.upstream.example.com",
			AuthPassthrough: MCPAuthForward,
		}},
	}
	data, err := c.CompileWithPlugins(baseSnapshot(), perRoute)
	if err != nil {
		t.Fatalf("CompileWithPlugins: %v", err)
	}

	routes := extractAllRoutes(t, data)
	if len(routes) < 2 {
		t.Fatalf("expected at least 2 routes (primary + mcp), got %d", len(routes))
	}
	mcp := routes[len(routes)-1]
	matches := mcp["match"].([]any)
	first := matches[0].(map[string]any)
	hosts := first["host"].([]any)
	if len(hosts) != 1 || hosts[0].(string) != "tools.example.com" {
		t.Errorf("host = %v, want tools.example.com", hosts)
	}
	paths := first["path"].([]any)
	if paths[0].(string) != "/mcp*" {
		t.Errorf("path = %v, want /mcp*", paths)
	}
	handlers := mcp["handle"].([]any)
	last := handlers[len(handlers)-1].(map[string]any)
	if last["handler"].(string) != "reverse_proxy" {
		t.Errorf("last handler = %v, want reverse_proxy", last["handler"])
	}
}

func TestCompileWithPlugins_MCPRoute_StripAuth(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})
	perRoute := PerRoutePlugins{
		MCPRoutes: []MCPRouteCompileConfig{{
			ID:              "mcpr_2",
			Hostname:        "tools.example.com",
			PathPrefix:      "/mcp",
			UpstreamURL:     "https://mcp.upstream.example.com",
			AuthPassthrough: MCPAuthStrip,
		}},
	}
	data, _ := c.CompileWithPlugins(baseSnapshot(), perRoute)
	routes := extractAllRoutes(t, data)
	mcp := routes[len(routes)-1]
	handlers := mcp["handle"].([]any)
	// Find headers handler — must delete Authorization.
	var found bool
	for _, h := range handlers {
		hm := h.(map[string]any)
		if hm["handler"] == "headers" {
			req := hm["request"].(map[string]any)
			del := req["delete"].([]any)
			if len(del) == 1 && del[0].(string) == "Authorization" {
				found = true
			}
		}
	}
	if !found {
		t.Errorf("strip path should emit headers.delete[Authorization], got handlers=%v", handlers)
	}
}

func TestCompileWithPlugins_MCPRoute_ReplaceAuth(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})
	perRoute := PerRoutePlugins{
		MCPRoutes: []MCPRouteCompileConfig{{
			ID:                 "mcpr_3",
			Hostname:           "tools.example.com",
			PathPrefix:         "/mcp",
			UpstreamURL:        "https://mcp.upstream.example.com",
			UpstreamCredential: "secret-token",
			AuthPassthrough:    MCPAuthReplace,
		}},
	}
	data, _ := c.CompileWithPlugins(baseSnapshot(), perRoute)
	routes := extractAllRoutes(t, data)
	mcp := routes[len(routes)-1]
	handlers := mcp["handle"].([]any)
	var found bool
	for _, h := range handlers {
		hm := h.(map[string]any)
		if hm["handler"] == "headers" {
			req := hm["request"].(map[string]any)
			set := req["set"].(map[string]any)
			if v, ok := set["Authorization"].([]any); ok && len(v) == 1 {
				if strings.Contains(v[0].(string), "Bearer secret-token") {
					found = true
				}
			}
		}
	}
	if !found {
		t.Errorf("replace path should emit headers.set[Authorization]=Bearer secret-token, got %v", handlers)
	}
}

func TestCompileWithPlugins_MCPRoute_Validator(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})
	perRoute := PerRoutePlugins{
		MCPRoutes: []MCPRouteCompileConfig{{
			ID:                    "mcpr_4",
			Hostname:              "tools.example.com",
			PathPrefix:            "/",
			UpstreamURL:           "https://mcp.upstream.example.com",
			AuthPassthrough:       MCPAuthForward,
			AuthValidatorEndpoint: "http://127.0.0.1:7791/mcp-validate",
		}},
	}
	data, _ := c.CompileWithPlugins(baseSnapshot(), perRoute)
	routes := extractAllRoutes(t, data)
	mcp := routes[len(routes)-1]
	handlers := mcp["handle"].([]any)
	first := handlers[0].(map[string]any)
	if first["handler"].(string) != "rioku_mcp_auth" {
		t.Errorf("first handler = %v, want rioku_mcp_auth (validator must run before reverse_proxy)", first["handler"])
	}
	if first["validator_endpoint"].(string) != "http://127.0.0.1:7791/mcp-validate" {
		t.Errorf("validator_endpoint = %v", first["validator_endpoint"])
	}
}

func TestCompileWithPlugins_MCPRoute_EmptyURLSkipped(t *testing.T) {
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})
	perRoute := PerRoutePlugins{
		MCPRoutes: []MCPRouteCompileConfig{{
			ID: "mcpr_skip", Hostname: "x", PathPrefix: "/x",
			UpstreamURL: "", // no upstream — must skip
		}},
	}
	data, _ := c.CompileWithPlugins(baseSnapshot(), perRoute)
	routes := extractAllRoutes(t, data)
	if len(routes) != 1 {
		t.Errorf("len(routes) = %d, want 1 (mcp route with empty URL must be skipped)", len(routes))
	}
}
