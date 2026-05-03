package caddy

import (
	"fmt"

	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
)

// CompileRoute converts a single Rioku route and its resolved service into a
// Caddy route object. The services map is used to look up the service when the
// route targets a service_id.
//
// CompileRoute is the legacy entry point that does not consult per-route
// plugin storage (#171 OAS, #172 WAF). It is preserved for tests and any
// external callers that built against the original signature; production
// code paths use Compile / CompileWithPlugins which call compileRoute
// with the loaded per-route plugin maps.
func (c *Compiler) CompileRoute(route *riokuv1.Route, services map[string]*riokuv1.Service) (map[string]any, error) {
	return c.compileRoute(route, services, PerRoutePlugins{})
}

// compileRoute is the per-plugin-aware route compiler. The OAS validator
// and Coraza WAF handlers are inserted between the request-mutation
// handlers (vars, request headers) and the reverse_proxy so:
//
//  1. tracing/vars run first — every request gets a trace ID and
//     route/service vars regardless of validation outcome.
//  2. WAF runs before OAS — request body inspection should reject
//     attack payloads before the OAS layer parses them. This also
//     matches the OWASP CRS reference deployment ordering.
//  3. OAS runs after WAF but before the upstream call — invalid
//     requests get a 400 from the validator without ever leaving
//     the gateway.
func (c *Compiler) compileRoute(route *riokuv1.Route, services map[string]*riokuv1.Service, perRoute PerRoutePlugins) (map[string]any, error) {
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
	//   -> [WAF] -> [OAS validator]
	//   -> [encode / compression] -> [request headers] -> reverse_proxy
	// Security headers are only added to traffic routes (CompileRoute), not admin.
	handleChain := []map[string]any{tracingHandler}
	if secHandler := c.buildSecurityHeadersHandler(); secHandler != nil {
		handleChain = append(handleChain, secHandler)
	}
	handleChain = append(handleChain, varsHandler)

	// Per-route WAF (#172) — runs before OAS so attack payloads do
	// not reach the spec validator (which would otherwise allocate
	// request body parsing for content the WAF rejects).
	if wafCfg := perRoute.WAFByRoute[route.GetId()]; wafCfg != nil {
		if wafHandler := buildWAFHandler(wafCfg); wafHandler != nil {
			handleChain = append(handleChain, wafHandler)
		}
	}

	// Per-route OAS validator (#171) — runs after WAF, before the
	// reverse_proxy.
	if oasCfg := perRoute.OASByRoute[route.GetId()]; oasCfg != nil {
		if oasHandler := buildOASValidatorHandler(oasCfg); oasHandler != nil {
			handleChain = append(handleChain, oasHandler)
		}
	}

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
