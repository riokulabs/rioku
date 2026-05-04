package gateway

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSettingsConfigs_AllSingletons(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterSettingsConfigRoutes(mux, drv)

	// Each: GET returns defaults, then PUT updates, then GET shows updated values.
	cases := []struct {
		name      string
		path      string
		body      map[string]any
		fieldKey  string
		fieldWant any
	}{
		{
			"network",
			"/api/v1/t/default/settings/network",
			map[string]any{
				"http3Enabled":        true,
				"readTimeoutSeconds":  30,
				"writeTimeoutSeconds": 30,
				"idleTimeoutSeconds":  60,
			},
			"http3Enabled", true,
		},
		{
			"auth-policy",
			"/api/v1/t/default/settings/auth-policy",
			map[string]any{
				"totpPolicy":        "all",
				"minLength":         16,
				"requireDigit":      true,
				"idleHours":         12,
				"absoluteHours":     72,
				"maxFailedAttempts": 3,
				"lockoutMinutes":    30,
			},
			"totpPolicy", "all",
		},
		{
			"audit-retention",
			"/api/v1/t/default/audit/retention",
			map[string]any{
				"retentionDaysRead":        14,
				"retentionDaysWrite":       180,
				"retentionDaysDestructive": 730,
				"autoExport":               "weekly",
				"autoExportFormat":         "csv",
			},
			"autoExport", "weekly",
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			// GET
			gr := httptest.NewRecorder()
			mux.ServeHTTP(gr, authedTenantRequest(t, drv, http.MethodGet, c.path, "default", nil))
			if gr.Code != http.StatusOK {
				t.Fatalf("get: %d", gr.Code)
			}

			// PUT
			pr := httptest.NewRecorder()
			mux.ServeHTTP(pr, authedTenantRequest(t, drv, http.MethodPut, c.path, "default", c.body))
			if pr.Code != http.StatusOK {
				t.Fatalf("put: %d (%s)", pr.Code, pr.Body.String())
			}

			// GET back
			gr2 := httptest.NewRecorder()
			mux.ServeHTTP(gr2, authedTenantRequest(t, drv, http.MethodGet, c.path, "default", nil))
			var body map[string]any
			_ = json.NewDecoder(gr2.Body).Decode(&body)
			got := body[c.fieldKey]
			// JSON numbers decode to float64; normalize.
			if wantNum, ok := c.fieldWant.(int); ok {
				if got.(float64) != float64(wantNum) {
					t.Errorf("%s = %v, want %v", c.fieldKey, got, wantNum)
				}
			} else if got != c.fieldWant {
				t.Errorf("%s = %v, want %v", c.fieldKey, got, c.fieldWant)
			}
		})
	}
}

func TestObservability_SectionedUpdates(t *testing.T) {
	drv := openTenantTestStore(t)
	mux := http.NewServeMux()
	RegisterSettingsConfigRoutes(mux, drv)

	// PUT /metrics
	r := httptest.NewRecorder()
	mux.ServeHTTP(r, authedTenantRequest(t, drv, http.MethodPut,
		"/api/v1/t/default/settings/observability/metrics", "default",
		map[string]any{"scrapeEndpoint": "https://prom.example", "retentionDays": 60}))
	if r.Code != http.StatusOK {
		t.Fatalf("metrics: %d", r.Code)
	}

	// PUT /traces
	r2 := httptest.NewRecorder()
	mux.ServeHTTP(r2, authedTenantRequest(t, drv, http.MethodPut,
		"/api/v1/t/default/settings/observability/traces", "default",
		map[string]any{"retentionDays": 30, "sampleRate": 0.1}))
	if r2.Code != http.StatusOK {
		t.Fatalf("traces: %d", r2.Code)
	}

	// GET should reflect both updates.
	r3 := httptest.NewRecorder()
	mux.ServeHTTP(r3, authedTenantRequest(t, drv, http.MethodGet,
		"/api/v1/t/default/settings/observability", "default", nil))
	var body observabilityResponse
	_ = json.NewDecoder(r3.Body).Decode(&body)
	if body.MetricsScrapeEndpoint != "https://prom.example" || body.MetricsRetentionDays != 60 {
		t.Errorf("metrics didn't stick: %+v", body)
	}
	if body.TracesRetentionDays != 30 || body.TracesSampleRate != 0.1 {
		t.Errorf("traces didn't stick: %+v", body)
	}
}
