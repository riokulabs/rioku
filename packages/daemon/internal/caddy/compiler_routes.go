package caddy

import (
	"fmt"

	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
)

// CompileRoute converts a single Rioku route and its resolved service into a
// Caddy route object. The services map is used to look up the service when the
// route targets a service_id.
func (c *Compiler) CompileRoute(route *riokuv1.Route, services map[string]*riokuv1.Service) (map[string]any, error) {
	caddyRoute := make(map[string]any)

	// --- Matchers ---
	matchSets, err := compileMatchers(route.GetMatchers())
	if err != nil {
		return nil, fmt.Errorf("compile matchers: %w", err)
	}
	if len(matchSets) > 0 {
		caddyRoute["match"] = matchSets
	}

	// --- Handlers ---
	handler, err := compileHandler(route, services)
	if err != nil {
		return nil, err
	}

	// Resolve the service ID for the vars handler.
	var serviceID string
	if t, ok := route.GetTarget().(*riokuv1.Route_ServiceId); ok {
		serviceID = t.ServiceId
	}

	// Tracing handler (OTEL) — placed first so the trace ID is available
	// to all subsequent handlers and logged by the access logger.
	tracingHandler := map[string]any{
		"handler": "tracing",
		"span":    "rioku",
	}

	// Use Caddy's built-in "vars" handler (http.handlers.vars) to set
	// Rioku context variables. No custom module needed — native Caddy.
	varsHandler := map[string]any{
		"handler":          "vars",
		"rioku_route_id":   route.GetId(),
		"rioku_service_id": serviceID,
	}
	// Build handler chain:
	//   tracing -> [security headers] -> vars
	//   -> [encode / compression] -> [request headers] -> reverse_proxy
	// Security headers are only added to traffic routes (CompileRoute), not admin.
	handleChain := []map[string]any{tracingHandler}
	if secHandler := c.buildSecurityHeadersHandler(); secHandler != nil {
		handleChain = append(handleChain, secHandler)
	}
	handleChain = append(handleChain, varsHandler)

	// Resolve the service for service-level handlers (compression, request
	// headers). DirectUpstream routes have neither, so we skip safely.
	if svcID, ok := route.GetTarget().(*riokuv1.Route_ServiceId); ok {
		if svc, exists := services[svcID.ServiceId]; exists {
			if compHandler := buildCompressionHandler(svc.GetCompression()); compHandler != nil {
				handleChain = append(handleChain, compHandler)
			}
			if reqHHandler := buildRequestHeadersHandler(svc.GetRequestHeaders()); reqHHandler != nil {
				handleChain = append(handleChain, reqHHandler)
			}
		}
	}

	handleChain = append(handleChain, handler)
	caddyRoute["handle"] = handleChain

	return caddyRoute, nil
}

// buildAdminServer creates the Caddy server block that reverse-proxies
// to the internal Go gateway on loopback.
func (c *Compiler) buildAdminServer() map[string]any {
	listenAddr := c.admin.ListenAddr
	if listenAddr == "" {
		listenAddr = ":7778"
	}

	// Domain overrides port-based listening.
	if c.admin.Domain != "" {
		listenAddr = ":443"
	}

	server := map[string]any{
		"listen": []string{listenAddr},
		"routes": []map[string]any{
			{
				"handle": []map[string]any{
					{
						"handler": "reverse_proxy",
						"upstreams": []map[string]any{
							{"dial": c.admin.InternalAddr},
						},
					},
				},
			},
		},
	}

	// Add host matcher when a dedicated domain is configured.
	if c.admin.Domain != "" {
		server["routes"].([]map[string]any)[0]["match"] = []map[string]any{
			{"host": []string{c.admin.Domain}},
		}
		if !c.admin.DevMode {
			server["tls_connection_policies"] = []map[string]any{{}}
		}
	}

	return server
}
