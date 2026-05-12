package caddy

import (
	"encoding/json"
	"testing"

	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
)

func TestCompile_AdminLogSuppression(t *testing.T) {
	// Verify that admin.api logger is configured to discard logs.
	socketPath := "/tmp/test.sock"
	c := NewCompiler([]string{":443"}, AdminConfig{}, socketPath, nil, SecurityHeadersConfig{})

	snapshot := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{
			{
				Id:      "r1",
				Enabled: true,
				Matchers: []*riokuv1.Matcher{
					{Hosts: []string{"api.example.com"}},
				},
				Target: &riokuv1.Route_ServiceId{ServiceId: "svc-1"},
			},
		},
		Services: []*riokuv1.Service{
			{
				Id:        "svc-1",
				Upstreams: []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
			},
		},
	}

	data, err := c.Compile(snapshot)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	// Verify admin logger exists and is configured correctly.
	logs := dig(t, cfg, "logging", "logs")

	// Check that "rioku_trace" still exists.
	_, ok := logs["rioku_trace"].(map[string]any)
	if !ok {
		t.Error("rioku_trace logger missing")
	}

	// Check that "admin" logger exists.
	adminLog, ok := logs["admin"].(map[string]any)
	if !ok {
		t.Fatal("admin logger missing")
	}

	// Verify include field contains admin.api.
	include, ok := adminLog["include"].([]any)
	if !ok {
		t.Fatal("include field missing or not an array")
	}
	if len(include) != 1 || include[0].(string) != "admin.api" {
		t.Errorf("include = %v, want [admin.api]", include)
	}

	// Verify writer output is discard.
	writer, ok := adminLog["writer"].(map[string]any)
	if !ok {
		t.Fatal("writer field missing or not a map")
	}
	output, ok := writer["output"].(string)
	if !ok {
		t.Fatal("writer.output missing or not a string")
	}
	if output != "discard" {
		t.Errorf("writer.output = %v, want discard", output)
	}

	// Verify level is ERROR.
	level, ok := adminLog["level"].(string)
	if !ok {
		t.Fatal("level field missing or not a string")
	}
	if level != "ERROR" {
		t.Errorf("level = %v, want ERROR", level)
	}
}

func TestCompile_AdminLogOnly_NoTrace(t *testing.T) {
	// When traceSocketPath is empty, there should be no logging block at all.
	c := NewCompiler([]string{":443"}, AdminConfig{}, "", nil, SecurityHeadersConfig{})

	snapshot := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{
			{
				Id:      "r1",
				Enabled: true,
				Matchers: []*riokuv1.Matcher{
					{Hosts: []string{"api.example.com"}},
				},
				Target: &riokuv1.Route_ServiceId{ServiceId: "svc-1"},
			},
		},
		Services: []*riokuv1.Service{
			{
				Id:        "svc-1",
				Upstreams: []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
			},
		},
	}

	data, err := c.Compile(snapshot)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	// When traceSocketPath is empty, no logging block should exist.
	if _, ok := cfg["logging"]; ok {
		t.Error("expected no logging block when traceSocketPath is empty")
	}

	// Verify traffic server has no logs config when trace is disabled.
	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	if _, ok := server["logs"]; ok {
		t.Error("expected no logs config on traffic server when traceSocketPath is empty")
	}
}

func TestCompile_AccessLogPreserved(t *testing.T) {
	// Verify that the rioku_trace access logger is not affected by admin logger addition.
	socketPath := "/tmp/test.sock"
	c := NewCompiler([]string{":443"}, AdminConfig{}, socketPath, nil, SecurityHeadersConfig{})

	snapshot := &riokuv1.ConfigSnapshot{
		Routes: []*riokuv1.Route{
			{
				Id:      "r1",
				Enabled: true,
				Matchers: []*riokuv1.Matcher{
					{Hosts: []string{"api.example.com"}},
				},
				Target: &riokuv1.Route_ServiceId{ServiceId: "svc-1"},
			},
		},
		Services: []*riokuv1.Service{
			{
				Id:        "svc-1",
				Upstreams: []*riokuv1.Upstream{{Address: "10.0.0.1:8080"}},
			},
		},
	}

	data, err := c.Compile(snapshot)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	// Verify rioku_trace logger is still intact.
	traceLog := dig(t, cfg, "logging", "logs", "rioku_trace")

	writer := traceLog["writer"].(map[string]any)
	if writer["output"].(string) != "net" {
		t.Errorf("writer.output = %v, want net", writer["output"])
	}

	encoder := traceLog["encoder"].(map[string]any)
	if encoder["format"].(string) != "json" {
		t.Errorf("encoder.format = %v, want json", encoder["format"])
	}

	include := traceLog["include"].([]any)
	if len(include) != 1 || include[0].(string) != "http.log.access.rioku" {
		t.Errorf("include = %v, want [http.log.access.rioku]", include)
	}

	// Verify traffic server still has access log config.
	server := dig(t, cfg, "apps", "http", "servers", "traffic")
	logs, ok := server["logs"].(map[string]any)
	if !ok {
		t.Fatal("traffic server missing logs config")
	}
	if logs["default_logger_name"].(string) != "rioku" {
		t.Errorf("default_logger_name = %v, want rioku", logs["default_logger_name"])
	}
}
