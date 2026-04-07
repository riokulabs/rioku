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

// Compiler converts Rioku config into Caddy JSON.
type Compiler struct {
	listenAddrs []string
}

// NewCompiler creates a compiler with the given listen addresses.
func NewCompiler(listenAddrs ...string) *Compiler {
	addrs := make([]string, len(listenAddrs))
	copy(addrs, listenAddrs)
	return &Compiler{listenAddrs: addrs}
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

	config := map[string]any{
		"apps": map[string]any{
			"http": map[string]any{
				"servers": map[string]any{
					"rioku": map[string]any{
						"listen": c.listenAddrs,
						"routes": caddyRoutes,
					},
				},
			},
		},
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
	caddyRoute["handle"] = []map[string]any{handler}

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
