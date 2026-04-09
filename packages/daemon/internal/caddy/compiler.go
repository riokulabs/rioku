// compiler.go compiles rioku config (routes, services, policies) into
// Caddy JSON configuration for push via the admin API.
package caddy

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
)

// AdminConfig controls how the admin server block is compiled.
type AdminConfig struct {
	// InternalAddr is the loopback address the Go net/http gateway is bound to,
	// e.g. "127.0.0.1:54321". The compiler uses this as the reverse_proxy upstream.
	InternalAddr string

	// ListenAddr is the external address Caddy listens on for admin traffic.
	// Defaults to ":7778" when empty.
	ListenAddr string

	// Domain is the optional dedicated admin domain (e.g. "admin.example.com").
	// When set, the admin server listens on ":443" and Caddy provisions auto-TLS.
	Domain string

	// DevMode disables TLS on the admin block (HTTP only).
	DevMode bool
}

// Compiler converts Rioku config into Caddy JSON.
type Compiler struct {
	trafficAddrs    []string
	admin           AdminConfig
	traceSocketPath string
}

// NewCompiler creates a compiler with the given traffic listen addresses, admin config,
// and optional trace socket path. When traceSocketPath is non-empty, the compiled
// Caddy config will include a logging block that sends access logs to the socket.
func NewCompiler(trafficAddrs []string, admin AdminConfig, traceSocketPath string) *Compiler {
	addrs := make([]string, len(trafficAddrs))
	copy(addrs, trafficAddrs)
	return &Compiler{trafficAddrs: addrs, admin: admin, traceSocketPath: traceSocketPath}
}

// Compile takes the full Rioku config snapshot and produces Caddy JSON.
// The returned bytes are ready to POST to Caddy's /load admin endpoint.
func (c *Compiler) Compile(snapshot *riokuv1.ConfigSnapshot) ([]byte, error) {
	// Build service lookup map keyed by service ID.
	services := make(map[string]*riokuv1.Service, len(snapshot.GetServices()))
	for _, svc := range snapshot.GetServices() {
		services[svc.GetId()] = svc
	}

	var caddyRoutes []map[string]any
	for _, route := range snapshot.GetRoutes() {
		if !route.GetEnabled() {
			continue
		}
		compiled, err := c.CompileRoute(route, services)
		if err != nil {
			return nil, fmt.Errorf("compiling route %q: %w", route.GetId(), err)
		}
		caddyRoutes = append(caddyRoutes, compiled)
	}

	// Ensure routes is an empty array, not null, when there are no routes.
	if caddyRoutes == nil {
		caddyRoutes = []map[string]any{}
	}

	servers := map[string]any{
		"traffic": map[string]any{
			"listen": c.trafficAddrs,
			"routes": caddyRoutes,
		},
	}

	if c.admin.InternalAddr != "" {
		servers["admin"] = c.buildAdminServer()
	}

	// Enable access logging on the traffic server.
	if c.traceSocketPath != "" {
		trafficSrv := servers["traffic"].(map[string]any)
		trafficSrv["logs"] = map[string]any{
			"default_logger_name": "rioku",
		}
	}

	// When using non-standard ports (not :443/:80), disable auto-HTTPS
	// entirely. ACME challenges need :80/:443, and internal/dev traffic
	// ports should not provision TLS certificates for host matchers.
	if !c.hasStandardPorts() {
		for _, srv := range servers {
			if s, ok := srv.(map[string]any); ok {
				s["automatic_https"] = map[string]any{
					"disable": true,
				}
			}
		}
	}

	config := map[string]any{
		"apps": map[string]any{
			"http": map[string]any{
				"servers": servers,
			},
		},
	}

	if c.traceSocketPath != "" {
		config["logging"] = map[string]any{
			"logs": map[string]any{
				"rioku_trace": map[string]any{
					"writer": map[string]any{
						"output":  "net",
						"address": "unix/" + c.traceSocketPath,
					},
					"encoder": map[string]any{
						"format": "json",
					},
					"include": []string{"http.log.access.rioku"},
				},
			},
		}
	}

	return json.Marshal(config)
}

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

	// Use Caddy's built-in "vars" handler (http.handlers.vars) to set
	// Rioku context variables. No custom module needed — native Caddy.
	varsHandler := map[string]any{
		"handler":          "vars",
		"rioku_route_id":   route.GetId(),
		"rioku_service_id": serviceID,
	}
	caddyRoute["handle"] = []map[string]any{varsHandler, handler}

	return caddyRoute, nil
}

// compileMatchers converts proto Matchers into Caddy match sets.
// Each proto Matcher becomes one match set (OR semantics between matchers).
func compileMatchers(matchers []*riokuv1.Matcher) ([]map[string]any, error) {
	var sets []map[string]any
	for _, m := range matchers {
		set := make(map[string]any)

		if len(m.GetHosts()) > 0 {
			set["host"] = m.GetHosts()
		}

		paths, pathRegexp, err := compilePaths(m.GetPaths())
		if err != nil {
			return nil, fmt.Errorf("compile paths: %w", err)
		}
		if len(paths) > 0 {
			set["path"] = paths
		}
		if pathRegexp != nil {
			set["path_regexp"] = pathRegexp
		}

		if len(m.GetMethods()) > 0 {
			set["method"] = m.GetMethods()
		}

		if len(m.GetHeaders()) > 0 {
			set["header"] = compileHeaders(m.GetHeaders())
		}

		if len(set) > 0 {
			sets = append(sets, set)
		}
	}
	return sets, nil
}

// compilePaths separates prefix/exact paths (returned as string slice) from
// regexp paths (returned as a path_regexp object). Only the first regexp
// matcher is used because Caddy's path_regexp is a single object per match set.
func compilePaths(paths []*riokuv1.PathMatcher) ([]string, map[string]any, error) {
	var plain []string
	var re map[string]any
	regexpCount := 0

	for _, p := range paths {
		switch p.GetType() {
		case riokuv1.PathMatcher_TYPE_PREFIX:
			v := p.GetValue()
			if !strings.HasSuffix(v, "*") {
				v = strings.TrimSuffix(v, "/") + "/*"
			}
			plain = append(plain, v)
		case riokuv1.PathMatcher_TYPE_EXACT:
			plain = append(plain, p.GetValue())
		case riokuv1.PathMatcher_TYPE_REGEXP:
			regexpCount++
			if regexpCount > 1 {
				return nil, nil, fmt.Errorf("only one regexp path matcher per match set is supported (got %d); split into separate matchers", regexpCount)
			}
			// Validate the regex compiles before sending to Caddy.
			if _, err := regexp.Compile(p.GetValue()); err != nil {
				return nil, nil, fmt.Errorf("invalid path regexp %q: %w", p.GetValue(), err)
			}
			re = map[string]any{
				"pattern": p.GetValue(),
			}
		}
	}
	return plain, re, nil
}

// compileHeaders converts proto HeaderMatchers into Caddy header match format.
// Caddy format: {"Header-Name": ["value"]}
func compileHeaders(headers []*riokuv1.HeaderMatcher) map[string][]string {
	result := make(map[string][]string, len(headers))
	for _, h := range headers {
		name := h.GetName()
		val := h.GetValue()
		// Caddy uses a "!" prefix on the value to invert the match.
		if h.GetInvert() {
			val = "!" + val
		}
		result[name] = append(result[name], val)
	}
	return result
}

// compileHandler builds the Caddy reverse_proxy handler for a route.
func compileHandler(route *riokuv1.Route, services map[string]*riokuv1.Service) (map[string]any, error) {
	handler := map[string]any{
		"handler": "reverse_proxy",
	}

	// Flush immediately so streamed responses (SSE, LLM streaming) are not
	// buffered by the reverse proxy. A value of -1 means "flush after every
	// write" in Caddy's reverse_proxy.
	handler["flush_interval"] = -1

	switch t := route.GetTarget().(type) {
	case *riokuv1.Route_ServiceId:
		svc, ok := services[t.ServiceId]
		if !ok {
			return nil, fmt.Errorf("service %q not found", t.ServiceId)
		}
		applyService(handler, svc)

	case *riokuv1.Route_Upstream:
		handler["upstreams"] = []map[string]any{
			{"dial": t.Upstream.GetAddress()},
		}

	default:
		return nil, fmt.Errorf("route %q has no target", route.GetId())
	}

	// TODO: compile policy_ids into Caddy middleware handlers inserted
	// before the reverse_proxy handler. Policies will map to rate limiting,
	// auth, transforms, and other Caddy handler modules.

	return handler, nil
}

// applyService sets upstreams, load balancing, and health checks on the handler
// from a proto Service.
func applyService(handler map[string]any, svc *riokuv1.Service) {
	// Upstreams
	upstreams := make([]map[string]any, 0, len(svc.GetUpstreams()))
	for _, u := range svc.GetUpstreams() {
		up := map[string]any{"dial": u.GetAddress()}
		upstreams = append(upstreams, up)
	}
	handler["upstreams"] = upstreams

	// Load balancing
	if policy := lbPolicyString(svc.GetLbPolicy()); policy != "" {
		lb := map[string]any{
			"selection_policy": map[string]any{
				"policy": policy,
			},
		}
		// For weighted round-robin, include upstream weights.
		if svc.GetLbPolicy() == riokuv1.LoadBalancingPolicy_LB_POLICY_WEIGHTED_ROUND_ROBIN {
			weights := make([]int32, 0, len(svc.GetUpstreams()))
			for _, u := range svc.GetUpstreams() {
				weights = append(weights, u.GetWeight())
			}
			lb["selection_policy"].(map[string]any)["weights"] = weights
		}
		handler["load_balancing"] = lb
	}

	// Health checks
	hc := svc.GetHealthCheck()
	if hc != nil && hc.GetEnabled() {
		active := make(map[string]any)
		if p := hc.GetPath(); p != "" {
			active["path"] = p
		}
		if v := hc.GetIntervalSeconds(); v > 0 {
			active["interval"] = fmt.Sprintf("%ds", v)
		}
		if v := hc.GetTimeoutSeconds(); v > 0 {
			active["timeout"] = fmt.Sprintf("%ds", v)
		}
		if v := hc.GetUnhealthyThreshold(); v > 0 {
			active["unhealthy_request_count"] = v
		}
		if v := hc.GetHealthyThreshold(); v > 0 {
			active["healthy_request_count"] = v
		}
		if statuses := hc.GetExpectedStatuses(); len(statuses) > 0 {
			active["expect_status"] = statuses
		}
		handler["health_checks"] = map[string]any{
			"active": active,
		}
	}
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

// hasStandardPorts returns true if the traffic addresses include :443 or :80,
// meaning Caddy's auto-HTTPS redirect to port 80 would be appropriate.
func (c *Compiler) hasStandardPorts() bool {
	for _, addr := range c.trafficAddrs {
		if addr == ":443" || addr == ":80" {
			return true
		}
	}
	return false
}

// lbPolicyString maps a proto LoadBalancingPolicy enum to the Caddy
// selection_policy string. Returns "" for unspecified.
func lbPolicyString(p riokuv1.LoadBalancingPolicy) string {
	switch p {
	case riokuv1.LoadBalancingPolicy_LB_POLICY_ROUND_ROBIN:
		return "round_robin"
	case riokuv1.LoadBalancingPolicy_LB_POLICY_RANDOM:
		return "random"
	case riokuv1.LoadBalancingPolicy_LB_POLICY_LEAST_CONN:
		return "least_conn"
	case riokuv1.LoadBalancingPolicy_LB_POLICY_IP_HASH:
		return "ip_hash"
	case riokuv1.LoadBalancingPolicy_LB_POLICY_WEIGHTED_ROUND_ROBIN:
		return "weighted_round_robin"
	default:
		return ""
	}
}
