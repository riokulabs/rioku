package caddy

import (
	"fmt"
	"strings"

	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
)

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
