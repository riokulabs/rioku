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

// TrustedProxiesConfig specifies which CIDR sources Caddy trusts for
// X-Forwarded-For / client IP resolution.
//
// Static contains always-trusted CIDR ranges. Dynamic holds a list of
// named strategies (e.g. "cloudflare", "static-url") that are refreshed
// periodically. Each entry corresponds to one TrustedProxiesDynamic proto
// value stored in the daemon config.
type TrustedProxiesConfig struct {
	// Ranges are always-trusted CIDR ranges (static sources).
	// e.g. ["10.0.0.0/8", "172.16.0.0/12"]
	Ranges []string

	// Dynamic holds entries for dynamic CIDR strategies.
	Dynamic []TrustedProxiesDynamicConfig
}

// TrustedProxiesDynamicConfig is the Go-level representation of one dynamic
// trusted-proxy strategy, mirroring the TrustedProxiesDynamic proto message.
type TrustedProxiesDynamicConfig struct {
	// Strategy is the source name: "cloudflare" or "static" (URL-based refresh).
	Strategy string

	// URL is the refresh endpoint for the "static" strategy.
	URL string

	// RefreshSeconds is how often to re-fetch. Zero uses the default (3600s).
	RefreshSeconds int32
}

// SecurityHeadersConfig controls which security response headers the compiler
// injects into every proxied response. The struct mirrors config.SecurityHeaders
// but lives in the caddy package to avoid a circular import (config -> caddy).
type SecurityHeadersConfig struct {
	Enabled             bool
	XContentTypeOptions string
	XFrameOptions       string
	ReferrerPolicy      string
	PermissionsPolicy   string
	CSP                 string
	CSPReportOnly       bool
	HSTS                HSTSConfig
}

// HSTSConfig controls the HTTP Strict Transport Security header.
type HSTSConfig struct {
	Enabled           bool
	MaxAge            int
	IncludeSubdomains bool
}

// OnDemandTLSConfig controls Caddy's on-demand TLS automation. When
// Enabled is true the compiler emits an `apps.tls.automation.on_demand.ask`
// URL pointing at AskURL — Caddy calls into that URL during the TLS
// handshake to validate that an unknown SNI matches a configured route.
// This is the security gate from issue #66.
type OnDemandTLSConfig struct {
	// Enabled turns the entire feature on. When false the compiler
	// emits no TLS automation block and Caddy falls back to its
	// default certificate-management behavior.
	Enabled bool

	// AskURL is the absolute URL Caddy will call to validate an SNI.
	// Typically "http://127.0.0.1:7790/tls/ask" — must be reachable
	// from the Caddy process. Required when Enabled is true.
	AskURL string

	// IntervalSeconds and Burst are passed through to Caddy's
	// `apps.tls.automation.on_demand.rate_limit` block when both are
	// > 0. They form a secondary defence on top of the ask gate
	// against runaway issuance attempts.
	IntervalSeconds int
	Burst           int
}

// Compiler converts Rioku config into Caddy JSON.
type Compiler struct {
	trafficAddrs    []string
	admin           AdminConfig
	traceSocketPath string
	trustedProxies  *TrustedProxiesConfig
	securityHeaders SecurityHeadersConfig
	onDemandTLS     OnDemandTLSConfig
}

// NewCompiler creates a compiler with the given traffic listen addresses, admin config,
// optional trace socket path, optional trusted proxy config, and security headers config.
// When traceSocketPath is non-empty, the compiled Caddy config will include a logging
// block that sends access logs to the socket. When trustedProxies is non-nil with ranges,
// each server block will include trusted_proxies for correct client IP resolution.
func NewCompiler(trafficAddrs []string, admin AdminConfig, traceSocketPath string, trustedProxies *TrustedProxiesConfig, secHeaders SecurityHeadersConfig) *Compiler {
	addrs := make([]string, len(trafficAddrs))
	copy(addrs, trafficAddrs)
	return &Compiler{trafficAddrs: addrs, admin: admin, traceSocketPath: traceSocketPath, trustedProxies: trustedProxies, securityHeaders: secHeaders}
}

// SetOnDemandTLS enables (or disables) on-demand TLS provisioning in
// future Compile() calls. Callers are expected to invoke this after
// construction once the daemon knows the local AskURL.
func (c *Compiler) SetOnDemandTLS(cfg OnDemandTLSConfig) {
	c.onDemandTLS = cfg
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

	// Add trusted_proxies to all server blocks when configured.
	if tp := buildTrustedProxiesBlock(c.trustedProxies); tp != nil {
		for _, srv := range servers {
			if s, ok := srv.(map[string]any); ok {
				s["trusted_proxies"] = tp
			}
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

	apps := map[string]any{
		"http": map[string]any{
			"servers": servers,
			"metrics": map[string]any{}, // Prometheus metrics at root http level
		},
	}

	if tls := c.buildTLSApp(); tls != nil {
		apps["tls"] = tls
	}

	config := map[string]any{
		"apps": apps,
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

// compileMatchers converts proto Matchers into Caddy match sets.
// Each proto Matcher becomes one match set (OR semantics between matchers).
func compileMatchers(matchers []*riokuv1.Matcher) ([]map[string]any, error) {
	var sets []map[string]any
	for _, m := range matchers {
		set, err := compileMatcherSet(m)
		if err != nil {
			return nil, err
		}
		if len(set) > 0 {
			sets = append(sets, set)
		}
	}
	return sets, nil
}

// compileMatcherSet builds a single Caddy match set from one proto
// Matcher. Pulled out of compileMatchers so the `not` clause can
// recurse without rebuilding the outer slice.
func compileMatcherSet(m *riokuv1.Matcher) (map[string]any, error) {
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

	header, headerRegexp, err := compileHeaders(m.GetHeaders())
	if err != nil {
		return nil, err
	}
	if len(header) > 0 {
		set["header"] = header
	}
	if len(headerRegexp) > 0 {
		set["header_regexp"] = headerRegexp
	}

	if q := compileQueries(m.GetQueries()); len(q) > 0 {
		set["query"] = q
	}

	if expr := m.GetExpression(); expr != "" {
		set["expression"] = expr
	}

	if nots := m.GetNot(); len(nots) > 0 {
		notSets := make([]map[string]any, 0, len(nots))
		for _, sub := range nots {
			s, err := compileMatcherSet(sub)
			if err != nil {
				return nil, fmt.Errorf("compile not matcher: %w", err)
			}
			if len(s) > 0 {
				notSets = append(notSets, s)
			}
		}
		if len(notSets) > 0 {
			set["not"] = notSets
		}
	}

	return set, nil
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

// compileHeaders converts proto HeaderMatchers into Caddy header
// match format, splitting plain entries (`header`) from regex entries
// (`header_regexp`). Plain Caddy format: {"Header-Name": ["value"]}.
// Regex format: {"Header-Name": {"pattern": "..."}}.
//
// Returns (header, header_regexp, error). Either or both maps may be
// empty. An invalid regex pattern produces an error so the operator
// finds out at compile time, not at request time.
func compileHeaders(headers []*riokuv1.HeaderMatcher) (map[string][]string, map[string]map[string]any, error) {
	plain := make(map[string][]string)
	regexes := make(map[string]map[string]any)
	for _, h := range headers {
		name := h.GetName()
		val := h.GetValue()
		if h.GetRegexp() {
			if _, err := regexp.Compile(val); err != nil {
				return nil, nil, fmt.Errorf("invalid header regexp on %q: %w", name, err)
			}
			// Caddy's header_regexp wants a single object per header
			// name. Last write wins if the operator supplies multiple
			// regex entries for the same header — we surface that as
			// an error so they don't silently lose patterns.
			if _, dup := regexes[name]; dup {
				return nil, nil, fmt.Errorf("multiple regexp matchers for header %q (Caddy header_regexp accepts one pattern per header)", name)
			}
			regexes[name] = map[string]any{"pattern": val}
			continue
		}
		// Caddy uses a "!" prefix on the value to invert the match.
		if h.GetInvert() {
			val = "!" + val
		}
		plain[name] = append(plain[name], val)
	}
	return plain, regexes, nil
}

// compileQueries converts proto QueryMatchers into Caddy's `query`
// match format: {"key": ["v1", "v2", ...]}. Multiple entries with the
// same key fold into a single slice (OR semantics). An empty value
// matches any value (existence-only check).
func compileQueries(queries []*riokuv1.QueryMatcher) map[string][]string {
	if len(queries) == 0 {
		return nil
	}
	result := make(map[string][]string, len(queries))
	for _, q := range queries {
		result[q.GetKey()] = append(result[q.GetKey()], q.GetValue())
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
		if err := applyService(handler, svc); err != nil {
			return nil, err
		}

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
func applyService(handler map[string]any, svc *riokuv1.Service) error {
	// Upstreams: classify into static vs dynamic.
	// Rules:
	//   - All static (source unset)        → emit upstreams array (existing behavior)
	//   - Exactly one with source set       → emit dynamic_upstreams only
	//   - Mixed or multiple dynamic         → reject at compile time
	var staticUpstreams []*riokuv1.Upstream
	var dynamicUpstream *riokuv1.Upstream

	for _, u := range svc.GetUpstreams() {
		switch u.GetSource().(type) {
		case *riokuv1.Upstream_SrvLookup, *riokuv1.Upstream_ALookup:
			if dynamicUpstream != nil {
				return fmt.Errorf("service %q: only one dynamic upstream is allowed per service", svc.GetId())
			}
			dynamicUpstream = u
		default:
			staticUpstreams = append(staticUpstreams, u)
		}
	}

	if dynamicUpstream != nil && len(staticUpstreams) > 0 {
		return fmt.Errorf("service %q: cannot mix static and dynamic upstreams", svc.GetId())
	}

	if dynamicUpstream != nil {
		// Emit dynamic_upstreams block; omit the static upstreams array.
		dynBlock, err := buildDynamicUpstreams(dynamicUpstream)
		if err != nil {
			return fmt.Errorf("service %q: build dynamic_upstreams: %w", svc.GetId(), err)
		}
		handler["dynamic_upstreams"] = dynBlock
		handler["upstreams"] = []map[string]any{} // required empty array per Caddy schema
	} else {
		upstreams := make([]map[string]any, 0, len(staticUpstreams))
		for _, u := range staticUpstreams {
			up := map[string]any{"dial": u.GetAddress()}
			upstreams = append(upstreams, up)
		}
		handler["upstreams"] = upstreams
	}

	// Load balancing
	if policy := lbPolicyString(svc.GetLbPolicy()); policy != "" {
		selection := map[string]any{
			"policy": policy,
		}
		switch svc.GetLbPolicy() {
		case riokuv1.LoadBalancingPolicy_LB_POLICY_WEIGHTED_ROUND_ROBIN:
			weights := make([]int32, 0, len(svc.GetUpstreams()))
			for _, u := range svc.GetUpstreams() {
				weights = append(weights, u.GetWeight())
			}
			selection["weights"] = weights
		case riokuv1.LoadBalancingPolicy_LB_POLICY_COOKIE:
			// Caddy's `cookie` selection policy. The default cookie
			// name in Caddy is "lb"; we pass the operator-supplied
			// override only when it's non-empty so the JSON stays
			// minimal in the common case.
			if name := svc.GetLbCookieName(); name != "" {
				selection["name"] = name
			}
		case riokuv1.LoadBalancingPolicy_LB_POLICY_HEADER:
			// Caddy's `header` selection policy hashes the named
			// header to pick an upstream. The header name is required.
			selection["field"] = svc.GetLbHeaderName()
		}
		handler["load_balancing"] = map[string]any{
			"selection_policy": selection,
		}
	}

	// Health checks (active + passive). Both blocks coexist under
	// `health_checks` in Caddy's reverse_proxy schema; we emit each
	// independently and only attach the parent when at least one fires.
	healthChecks := map[string]any{}

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
		healthChecks["active"] = active
	}

	if passive := buildPassiveHealthCheck(svc.GetPassiveHealthCheck()); passive != nil {
		healthChecks["passive"] = passive
	}

	if len(healthChecks) > 0 {
		handler["health_checks"] = healthChecks
	}

	// Retry policy (#69). Retries only apply when there are multiple
	// upstreams; with a single backend Caddy ignores lb_retries. We
	// emit the block regardless when enabled — the operator may have
	// just removed an upstream and the policy stays meaningful.
	if rp := svc.GetRetryPolicy(); rp != nil && rp.GetEnabled() && rp.GetMaxRetries() > 0 {
		handler["lb_retries"] = rp.GetMaxRetries()
		if v := rp.GetTryDurationMs(); v > 0 {
			handler["lb_try_duration"] = fmt.Sprintf("%dms", v)
		}
		if v := rp.GetTryIntervalMs(); v > 0 {
			handler["lb_try_interval"] = fmt.Sprintf("%dms", v)
		}
		if statuses := rp.GetRetryOnStatus(); len(statuses) > 0 {
			handler["lb_retry_match"] = []map[string]any{
				{"status_code": statuses},
			}
		}
	}

	// Transport: timeouts (#5 — already supported), upstream TLS (#70),
	// and connection-pool tuning (#70). All three feed the same
	// `reverse_proxy.transport` block.
	dialTimeout := svc.GetDialTimeoutSeconds()
	respHeaderTimeout := svc.GetResponseHeaderTimeoutSeconds()
	idleTimeout := svc.GetIdleTimeoutSeconds()
	upstreamTLS := svc.GetUpstreamTls()
	connPool := svc.GetConnectionPool()

	transport := map[string]any{}
	keepAlive := map[string]any{}

	if dialTimeout > 0 {
		transport["dial_timeout"] = fmt.Sprintf("%ds", dialTimeout)
	}
	if respHeaderTimeout > 0 {
		transport["response_header_timeout"] = fmt.Sprintf("%ds", respHeaderTimeout)
	}
	if idleTimeout > 0 {
		keepAlive["idle_conn_timeout"] = fmt.Sprintf("%ds", idleTimeout)
	}

	if upstreamTLS != nil && upstreamTLS.GetEnabled() {
		tls := map[string]any{}
		if v := upstreamTLS.GetServerName(); v != "" {
			tls["server_name"] = v
		}
		if upstreamTLS.GetInsecureSkipVerify() {
			tls["insecure_skip_verify"] = true
		}
		if v := upstreamTLS.GetRootCaPem(); v != "" {
			tls["root_ca_pem"] = []string{v}
		}
		if cert, key := upstreamTLS.GetClientCertPem(), upstreamTLS.GetClientKeyPem(); cert != "" && key != "" {
			tls["client_certificate_file"] = cert
			tls["client_certificate_key_file"] = key
		}
		if v := upstreamTLS.GetMinVersion(); v != "" {
			tls["protocol_min"] = "tls" + v
		}
		if v := upstreamTLS.GetMaxVersion(); v != "" {
			tls["protocol_max"] = "tls" + v
		}
		// Empty enabled-block is still valid — Caddy will use defaults.
		transport["tls"] = tls
	}

	// request_buffers / response_buffers (#159 residual): emitted into the
	// transport block when non-zero. Zero means "use Caddy default" (4096),
	// so we omit the keys to keep the JSON minimal and avoid overriding
	// Caddy's own defaults with an explicit zero.
	if upstreamTLS != nil {
		if v := upstreamTLS.GetRequestBuffers(); v > 0 {
			transport["request_buffers"] = v
		}
		if v := upstreamTLS.GetResponseBuffers(); v > 0 {
			transport["response_buffers"] = v
		}
	}

	if connPool != nil {
		if v := connPool.GetMaxConnsPerUpstream(); v > 0 {
			transport["max_conns_per_host"] = v
		}
		if v := connPool.GetMaxIdleConnsPerUpstream(); v > 0 {
			keepAlive["max_idle_conns_per_host"] = v
		}
		if v := connPool.GetMaxIdleConns(); v > 0 {
			keepAlive["max_idle_conns"] = v
		}
		if v := connPool.GetWriteBufferKb(); v > 0 {
			transport["write_buffer_size"] = v * 1024
		}
		if v := connPool.GetReadBufferKb(); v > 0 {
			transport["read_buffer_size"] = v * 1024
		}
	}

	if len(keepAlive) > 0 {
		transport["keep_alive"] = keepAlive
	}
	if len(transport) > 0 {
		// `protocol: http` is required for Caddy to recognize the block;
		// it's the only protocol we currently support compiling for.
		transport["protocol"] = "http"
		handler["transport"] = transport
	}

	// Response headers (#161): embedded into reverse_proxy.headers.response.
	if respHBlock := buildResponseHeadersBlock(svc.GetResponseHeaders()); respHBlock != nil {
		handler["headers"] = map[string]any{
			"response": respHBlock,
		}
	}

	// Response rules (#161): reverse_proxy.handle_response array.
	if rules := buildHandleResponse(svc.GetResponseRules()); len(rules) > 0 {
		handler["handle_response"] = rules
	}

	return nil
}

// buildTrustedProxiesBlock converts a TrustedProxiesConfig into the Caddy
// trusted_proxies value for a server block. Returns nil when there is nothing
// to configure.
//
// Static-only (no dynamic entries): emits the standard
//
//	{"source": "static", "ranges": [...]}
//
// Static + dynamic: emits the static block plus, for each dynamic entry, a
// separate named-module block. Caddy 2.x supports plug-in IP-source modules
// for "cloudflare" etc. For the "static" URL-refresh strategy we emit a
// placeholder block with the URL/refresh so that a future IP-source module can
// consume it. Limitations are documented with inline comments.
//
// NOTE: Caddy's server-level `trusted_proxies` key accepts a single IP-source
// module object (not an array). When dynamic entries are present we emit the
// first one; if both static CIDRs and dynamic strategies are configured we
// prefer the dynamic entry and add the static ranges to its block where
// possible. This is a best-effort mapping — operators with complex mixed
// configurations should validate the emitted Caddy JSON.
func buildTrustedProxiesBlock(cfg *TrustedProxiesConfig) any {
	if cfg == nil {
		return nil
	}
	hasStatic := len(cfg.Ranges) > 0
	hasDynamic := len(cfg.Dynamic) > 0

	if !hasStatic && !hasDynamic {
		return nil
	}

	// Static-only: use the simple "static" source module.
	if !hasDynamic {
		return map[string]any{
			"source": "static",
			"ranges": cfg.Ranges,
		}
	}

	// Dynamic present: emit the first dynamic strategy as the primary source.
	// Caddy's trusted_proxies accepts a single IP-source module object.
	first := cfg.Dynamic[0]
	const defaultRefreshSec = 3600
	refresh := first.RefreshSeconds
	if refresh <= 0 {
		refresh = defaultRefreshSec
	}

	switch first.Strategy {
	case "cloudflare":
		// Compiles to Caddy's cloudflare IP-source module. Static ranges are
		// not forwarded to this module (Cloudflare manages its own list).
		// Install github.com/caddy-dns/cloudflare or equivalent module.
		block := map[string]any{
			"source":  "cloudflare",
			"refresh": fmt.Sprintf("%ds", refresh),
		}
		return block

	default:
		// "static" URL-refresh strategy (or unknown). Emit a static block with
		// the known CIDRs. Caddy does not have a built-in URL-refresh source;
		// the URL and refresh are stored for operator reference and future
		// module support.
		ranges := append([]string{}, cfg.Ranges...)
		block := map[string]any{
			"source": "static",
			"ranges": ranges,
			// Informational fields — consumed by future dynamic IP-source modules.
			"_strategy_url":     first.URL,
			"_strategy_refresh": fmt.Sprintf("%ds", refresh),
		}
		return block
	}
}

// buildDynamicUpstreams converts a single dynamic Upstream (SrvLookup or
// ALookup) into a Caddy `dynamic_upstreams` block. The refresh duration is
// converted from seconds to nanoseconds (Go time.Duration).
func buildDynamicUpstreams(u *riokuv1.Upstream) (map[string]any, error) {
	const defaultRefreshNs = 60 * 1_000_000_000 // 60s in nanoseconds

	switch src := u.GetSource().(type) {
	case *riokuv1.Upstream_SrvLookup:
		srv := src.SrvLookup
		refresh := int64(srv.GetRefreshSeconds()) * 1_000_000_000
		if refresh <= 0 {
			refresh = defaultRefreshNs
		}
		block := map[string]any{
			"source":  "srv",
			"service": srv.GetService(),
			"refresh": refresh,
		}
		if p := srv.GetProto(); p != "" {
			block["proto"] = p
		}
		return block, nil

	case *riokuv1.Upstream_ALookup:
		al := src.ALookup
		refresh := int64(al.GetRefreshSeconds()) * 1_000_000_000
		if refresh <= 0 {
			refresh = defaultRefreshNs
		}
		return map[string]any{
			"source":  "a",
			"name":    al.GetName(),
			"port":    fmt.Sprintf("%d", al.GetPort()),
			"refresh": refresh,
		}, nil

	default:
		return nil, fmt.Errorf("upstream %q has no dynamic source set", u.GetId())
	}
}

// buildPassiveHealthCheck returns the Caddy `health_checks.passive`
// block for the supplied proto, or nil if passive checking is disabled
// or has no meaningful thresholds set. A passive block with all-zero
// thresholds would be a no-op in Caddy but pollutes the config; we
// suppress it here to keep the compiled JSON clean.
func buildPassiveHealthCheck(phc *riokuv1.PassiveHealthCheck) map[string]any {
	if phc == nil || !phc.GetEnabled() {
		return nil
	}
	out := map[string]any{}
	if v := phc.GetFailDurationSeconds(); v > 0 {
		out["fail_duration"] = fmt.Sprintf("%ds", v)
	}
	if v := phc.GetMaxFails(); v > 0 {
		out["max_fails"] = v
	}
	if statuses := phc.GetUnhealthyStatus(); len(statuses) > 0 {
		out["unhealthy_status"] = statuses
	}
	if v := phc.GetUnhealthyLatencyMs(); v > 0 {
		out["unhealthy_latency"] = fmt.Sprintf("%dms", v)
	}
	if v := phc.GetUnhealthyRequestCount(); v > 0 {
		out["unhealthy_request_count"] = v
	}
	// Suppress an empty block — see comment above.
	if len(out) == 0 {
		return nil
	}
	return out
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

// buildSecurityHeadersHandler constructs a Caddy headers handler with the
// configured security response headers. Returns nil if security headers are
// disabled or all header values are empty (caller should skip insertion).
func (c *Compiler) buildSecurityHeadersHandler() map[string]any {
	cfg := c.securityHeaders
	if !cfg.Enabled {
		return nil
	}

	set := make(map[string][]string)

	if cfg.XContentTypeOptions != "" {
		set["X-Content-Type-Options"] = []string{cfg.XContentTypeOptions}
	}
	if cfg.XFrameOptions != "" {
		set["X-Frame-Options"] = []string{cfg.XFrameOptions}
	}
	if cfg.ReferrerPolicy != "" {
		set["Referrer-Policy"] = []string{cfg.ReferrerPolicy}
	}
	if cfg.PermissionsPolicy != "" {
		set["Permissions-Policy"] = []string{cfg.PermissionsPolicy}
	}

	// CSP: emit either enforcing or report-only header, not both.
	if cfg.CSP != "" {
		if cfg.CSPReportOnly {
			set["Content-Security-Policy-Report-Only"] = []string{cfg.CSP}
		} else {
			set["Content-Security-Policy"] = []string{cfg.CSP}
		}
	}

	// HSTS: only when enabled AND running on standard ports.
	if cfg.HSTS.Enabled && c.hasStandardPorts() {
		hstsVal := fmt.Sprintf("max-age=%d", cfg.HSTS.MaxAge)
		if cfg.HSTS.IncludeSubdomains {
			hstsVal += "; includeSubDomains"
		}
		set["Strict-Transport-Security"] = []string{hstsVal}
	}

	// If no headers ended up in the set, return nil (skip insertion).
	if len(set) == 0 {
		return nil
	}

	return map[string]any{
		"handler": "headers",
		"response": map[string]any{
			"set": set,
		},
	}
}

// buildTLSApp returns the `apps.tls` block for on-demand TLS provisioning
// when c.onDemandTLS is enabled, or nil to omit the block entirely.
//
// The compiled block instructs Caddy to call AskURL during the TLS
// handshake for any unknown SNI; the rioku tlsask service answers
// 200/403 based on whether the host is allow-listed by a configured,
// enabled route. This is the security gate from issue #66 — without
// the ask URL, on-demand TLS would let an attacker trigger ACME
// issuance for any domain pointed at the gateway.
func (c *Compiler) buildTLSApp() map[string]any {
	if !c.onDemandTLS.Enabled {
		return nil
	}
	if c.onDemandTLS.AskURL == "" {
		// Misconfigured: enabled without an ask URL. Refuse to emit
		// the block — silently allowing on-demand TLS without the
		// gate would let an attacker drive ACME issuance for any
		// host. The daemon should never reach this state because
		// SetOnDemandTLS is invoked with both fields together.
		return nil
	}

	onDemand := map[string]any{
		"ask": c.onDemandTLS.AskURL,
	}
	if c.onDemandTLS.IntervalSeconds > 0 && c.onDemandTLS.Burst > 0 {
		onDemand["rate_limit"] = map[string]any{
			"interval": fmt.Sprintf("%ds", c.onDemandTLS.IntervalSeconds),
			"burst":    c.onDemandTLS.Burst,
		}
	}

	return map[string]any{
		"automation": map[string]any{
			"policies": []map[string]any{
				{
					"on_demand": true,
				},
			},
			"on_demand": onDemand,
		},
	}
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

// buildRequestHeadersHandler returns a Caddy `headers` handler that mutates
// request headers before they are forwarded to the upstream. Returns nil when
// the RequestHeaders proto is nil or all fields are empty (nothing to do).
func buildRequestHeadersHandler(rh *riokuv1.RequestHeaders) map[string]any {
	if rh == nil {
		return nil
	}
	request := map[string]any{}
	if m := rh.GetSet(); len(m) > 0 {
		set := make(map[string][]string, len(m))
		for k, v := range m {
			set[k] = []string{v}
		}
		request["set"] = set
	}
	if m := rh.GetAdd(); len(m) > 0 {
		add := make(map[string][]string, len(m))
		for k, v := range m {
			add[k] = []string{v}
		}
		request["add"] = add
	}
	if del := rh.GetDelete(); len(del) > 0 {
		request["delete"] = del
	}
	if len(request) == 0 {
		return nil
	}
	return map[string]any{
		"handler": "headers",
		"request": request,
	}
}

// buildResponseHeadersBlock returns the Caddy reverse_proxy
// `headers.response` sub-object for embedding into the reverse_proxy handler.
// Returns nil when the ResponseHeaders proto is nil or all fields are empty.
func buildResponseHeadersBlock(rh *riokuv1.ResponseHeaders) map[string]any {
	if rh == nil {
		return nil
	}
	resp := map[string]any{}
	if m := rh.GetSet(); len(m) > 0 {
		set := make(map[string][]string, len(m))
		for k, v := range m {
			set[k] = []string{v}
		}
		resp["set"] = set
	}
	if m := rh.GetAdd(); len(m) > 0 {
		add := make(map[string][]string, len(m))
		for k, v := range m {
			add[k] = []string{v}
		}
		resp["add"] = add
	}
	if del := rh.GetDelete(); len(del) > 0 {
		resp["delete"] = del
	}
	if len(resp) == 0 {
		return nil
	}
	return resp
}

// buildHandleResponse converts a slice of ResponseRule protos into a Caddy
// reverse_proxy `handle_response` array. Rules with no match status codes or
// no action are silently skipped.
func buildHandleResponse(rules []*riokuv1.ResponseRule) []map[string]any {
	if len(rules) == 0 {
		return nil
	}
	var out []map[string]any
	for _, rule := range rules {
		if len(rule.GetMatchStatusCodes()) == 0 {
			continue
		}

		// Expand wildcard codes (e.g. "5xx") into explicit integer ranges.
		codes := expandStatusCodes(rule.GetMatchStatusCodes())

		var handlers []map[string]any
		switch a := rule.GetAction().(type) {
		case *riokuv1.ResponseRule_Rewrite:
			rw := map[string]any{"handler": "rewrite"}
			if v := a.Rewrite.GetMethod(); v != "" {
				rw["method"] = v
			}
			if v := a.Rewrite.GetUri(); v != "" {
				rw["uri"] = v
			}
			handlers = []map[string]any{rw}
		case *riokuv1.ResponseRule_ServeErrorPage:
			ep := a.ServeErrorPage
			staticResp := map[string]any{"handler": "static_response"}
			if sc := ep.GetStatusCode(); sc > 0 {
				staticResp["status_code"] = sc
			} else {
				staticResp["status_code"] = 502
			}
			if b := ep.GetBody(); b != "" {
				staticResp["body"] = b
			}
			ct := ep.GetContentType()
			if ct == "" {
				ct = "text/html; charset=utf-8"
			}
			staticResp["headers"] = map[string][]string{
				"Content-Type": {ct},
			}
			handlers = []map[string]any{staticResp}
		case *riokuv1.ResponseRule_RouteTo:
			// Emit a rewrite to the named route's path (best-effort: just
			// set a vars handler with the target route ID so the daemon can
			// handle dispatching).
			handlers = []map[string]any{
				{
					"handler":           "vars",
					"rioku_route_to_id": a.RouteTo,
				},
			}
		default:
			continue
		}

		entry := map[string]any{
			"match": map[string]any{
				"status_code": codes,
			},
			"routes": []map[string]any{
				{"handle": handlers},
			},
		}
		out = append(out, entry)
	}
	return out
}

// expandStatusCodes converts a mixed list of explicit status codes and wildcard
// patterns (e.g. "5xx", "4xx") into a flat slice of integers. Explicit numeric
// strings (e.g. "502") are parsed directly; invalid entries are skipped.
func expandStatusCodes(codes []string) []int {
	var out []int
	for _, c := range codes {
		if strings.HasSuffix(c, "xx") && len(c) == 3 {
			prefix := c[0]
			base := int(prefix-'0') * 100
			for i := 0; i <= 99; i++ {
				out = append(out, base+i)
			}
			continue
		}
		// Try to parse as an integer.
		n := 0
		valid := len(c) > 0
		for _, ch := range c {
			if ch < '0' || ch > '9' {
				valid = false
				break
			}
			n = n*10 + int(ch-'0')
		}
		if valid && n > 0 {
			out = append(out, n)
		}
	}
	return out
}

// buildCompressionHandler returns a Caddy `encode` handler for gzip/zstd
// compression of upstream responses. Returns nil when Compression is nil,
// disabled, or has no encodings configured.
func buildCompressionHandler(comp *riokuv1.Compression) map[string]any {
	if comp == nil || !comp.GetEnabled() {
		return nil
	}
	encodings := comp.GetEncodings()
	if len(encodings) == 0 {
		return nil
	}
	encMap := make(map[string]any, len(encodings))
	for _, enc := range encodings {
		encMap[enc] = map[string]any{}
	}
	minLen := comp.GetMinLength()
	if minLen <= 0 {
		minLen = 1024
	}
	return map[string]any{
		"handler":        "encode",
		"encodings":      encMap,
		"minimum_length": minLen,
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
	case riokuv1.LoadBalancingPolicy_LB_POLICY_COOKIE:
		return "cookie"
	case riokuv1.LoadBalancingPolicy_LB_POLICY_URI_HASH:
		return "uri_hash"
	case riokuv1.LoadBalancingPolicy_LB_POLICY_HEADER:
		return "header"
	default:
		return ""
	}
}
