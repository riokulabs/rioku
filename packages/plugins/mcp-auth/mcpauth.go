// Package mcpauth implements the rioku_mcp_auth Caddy module
// (#181, #201, D9). It runs in front of the MCP gateway's
// reverse_proxy and resolves the inbound API key to its mcp_team's
// allow-list, rejecting tools/call requests for tools the team is
// not authorised to invoke.
//
// Wire model:
//
//	client -> Caddy (rioku_apikey -> rioku_mcp_auth -> reverse_proxy)
//	                                      |
//	                                      v
//	                               daemon /mcp-validate
//	                                      |
//	                                      v
//	                           mcp_team -> permissions allow-list
//
// rioku_apikey stamps X-Rioku-API-Key-Hash on the upstream-bound
// request when the resolved key has a Plan binding. rioku_mcp_auth
// extends that pattern — when the resolved key has an mcp_team
// binding, the daemon-side validator surfaces the team allow-list
// and the module enforces it against the inbound JSON-RPC body.
package mcpauth

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/caddyserver/caddy/v2"
	"github.com/caddyserver/caddy/v2/caddyconfig/caddyfile"
	"github.com/caddyserver/caddy/v2/caddyconfig/httpcaddyfile"
	"github.com/caddyserver/caddy/v2/modules/caddyhttp"
	"go.uber.org/zap"
)

func init() {
	caddy.RegisterModule(MCPAuth{})
	httpcaddyfile.RegisterHandlerDirective("rioku_mcp_auth", parseCaddyfile)
}

// MCPAuth is the Caddy handler that calls the daemon-side validator
// and rejects tool calls outside the team's allow-list.
type MCPAuth struct {
	// ValidatorEndpoint is the daemon-side URL the module POSTs to.
	// Default: empty (rejects all tool calls — fail-closed when the
	// operator forgets to wire the endpoint).
	ValidatorEndpoint string `json:"validator_endpoint,omitempty"`

	// MCPServerID is the id of the upstream MCP server this Caddy
	// route fronts. The validator uses it to scope the allow-list
	// lookup to the right server entry on the team.
	MCPServerID string `json:"mcp_server_id,omitempty"`

	// HTTPClient backs the validator call. Constructed at Provision.
	httpClient *http.Client
	logger     *zap.Logger
}

// CaddyModule registers the handler under http.handlers.rioku_mcp_auth.
func (MCPAuth) CaddyModule() caddy.ModuleInfo {
	return caddy.ModuleInfo{
		ID:  "http.handlers.rioku_mcp_auth",
		New: func() caddy.Module { return new(MCPAuth) },
	}
}

// Provision wires the HTTP client. The 3s timeout caps the per-
// request wait on a hung daemon validator: rioku_mcp_auth runs on
// the data-plane request hot path, so a stuck validator must not
// block inbound requests indefinitely. Soft-fail behaviour above
// (Validate is a no-op when validator_endpoint is empty) lets the
// data plane keep serving when the daemon is restarting.
func (m *MCPAuth) Provision(ctx caddy.Context) error {
	m.logger = ctx.Logger()
	m.httpClient = &http.Client{Timeout: 3 * time.Second}
	return nil
}

// Validate is a no-op — the module stays soft-fail when the
// validator is misconfigured (logs at warn) so a partial deployment
// doesn't take the whole route offline.
func (m *MCPAuth) Validate() error { return nil }

// jsonRPCEnvelope is the minimal JSON-RPC shape we read. We only
// care about method (specifically "tools/call") and params.name (the
// tool name). The rest of the body streams to the upstream verbatim.
type jsonRPCEnvelope struct {
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
}

type toolsCallParams struct {
	Name string `json:"name"`
}

// allowResponse is what /mcp-validate returns. Empty allowed_tools +
// no_team = pass-through (rioku_apikey resolved a non-MCP key — no
// enforcement to apply). When team is set and allowed_tools is
// present (possibly with "*"), enforcement runs.
type allowResponse struct {
	Allow  bool   `json:"allow"`
	Reason string `json:"reason,omitempty"`
	NoTeam bool   `json:"no_team,omitempty"`
	TeamID string `json:"team_id,omitempty"`
}

// ServeHTTP runs the auth check.
func (m *MCPAuth) ServeHTTP(w http.ResponseWriter, r *http.Request, next caddyhttp.Handler) error {
	// Read the full body — JSON-RPC requests are typically a few
	// hundred bytes (tools/list / tools/call). Cap at 4 MiB so a
	// malformed/oversized payload doesn't sink the request path.
	body, err := io.ReadAll(io.LimitReader(r.Body, 4<<20))
	if err != nil {
		http.Error(w, "read body: "+err.Error(), http.StatusBadRequest)
		return nil
	}
	r.Body = io.NopCloser(bytes.NewReader(body))
	r.ContentLength = int64(len(body))

	method, toolName := extractToolCall(body)
	// tools/list and other JSON-RPC methods always fall through
	// (the team-allow-list is per (server, tool); only tools/call
	// requires authorization). The MCP server itself filters
	// tools/list based on which tools the inbound request can
	// invoke; that's a v3 expansion (#181 v3 deferred).
	if method != "tools/call" || toolName == "" {
		return next.ServeHTTP(w, r)
	}

	// Validator endpoint must be configured for v1 MCP routes. If
	// missing, reject — the operator forgot to wire it.
	if m.ValidatorEndpoint == "" {
		return m.deny(w, http.StatusForbidden, "validator unconfigured")
	}

	keyHash := strings.TrimSpace(r.Header.Get("X-Rioku-API-Key-Hash"))
	if keyHash == "" {
		// rioku_apikey didn't run, or the key didn't resolve to a
		// plan/team — the team-allow-list cannot be enforced.
		// Fail-closed.
		return m.deny(w, http.StatusUnauthorized, "missing api key resolution")
	}

	allow, err := m.checkAllowed(r, keyHash, toolName)
	if err != nil {
		if m.logger != nil {
			m.logger.Warn("mcp validator error", zap.Error(err))
		}
		return m.deny(w, http.StatusBadGateway, "validator unreachable")
	}
	if allow.NoTeam {
		// Key is valid but not bound to an MCP team. The route is
		// MCP — reject (operator should bind the key to a team
		// before granting MCP access).
		return m.deny(w, http.StatusForbidden, "api key not bound to mcp team")
	}
	if !allow.Allow {
		reason := allow.Reason
		if reason == "" {
			reason = "tool not in team allow-list"
		}
		return m.deny(w, http.StatusForbidden, reason)
	}
	return next.ServeHTTP(w, r)
}

func (m *MCPAuth) checkAllowed(r *http.Request, keyHash, toolName string) (*allowResponse, error) {
	body, err := json.Marshal(map[string]string{
		"api_key_hash":  keyHash,
		"tool_name":     toolName,
		"mcp_server_id": m.MCPServerID,
	})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, m.ValidatorEndpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := m.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode/100 != 2 {
		return nil, fmt.Errorf("validator returned %d", resp.StatusCode)
	}
	var out allowResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (m *MCPAuth) deny(w http.ResponseWriter, status int, reason string) error {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"error":  "mcp_forbidden",
		"reason": reason,
	})
	return nil
}

// extractToolCall pulls (method, tool_name) out of a JSON-RPC body.
// Returns ("","") on parse error or when the body isn't tools/call —
// the caller treats those as fall-through.
func extractToolCall(body []byte) (string, string) {
	if len(body) == 0 {
		return "", ""
	}
	var env jsonRPCEnvelope
	if err := json.Unmarshal(body, &env); err != nil {
		return "", ""
	}
	if env.Method != "tools/call" || len(env.Params) == 0 {
		return env.Method, ""
	}
	var p toolsCallParams
	if err := json.Unmarshal(env.Params, &p); err != nil {
		return env.Method, ""
	}
	return env.Method, strings.TrimSpace(p.Name)
}

// UnmarshalCaddyfile parses the Caddyfile directive. Shape:
//
//	rioku_mcp_auth {
//	    validator_endpoint http://127.0.0.1:7791/mcp-validate
//	    mcp_server_id      mcp_srv_xyz
//	}
func (m *MCPAuth) UnmarshalCaddyfile(d *caddyfile.Dispenser) error {
	for d.Next() {
		for d.NextBlock(0) {
			switch d.Val() {
			case "validator_endpoint":
				if !d.NextArg() {
					return d.ArgErr()
				}
				m.ValidatorEndpoint = d.Val()
			case "mcp_server_id":
				if !d.NextArg() {
					return d.ArgErr()
				}
				m.MCPServerID = d.Val()
			default:
				return d.Errf("unknown rioku_mcp_auth option %q", d.Val())
			}
		}
	}
	return nil
}

func parseCaddyfile(h httpcaddyfile.Helper) (caddyhttp.MiddlewareHandler, error) {
	var m MCPAuth
	if err := m.UnmarshalCaddyfile(h.Dispenser); err != nil {
		return nil, err
	}
	return &m, nil
}

var (
	_ caddy.Provisioner           = (*MCPAuth)(nil)
	_ caddy.Validator             = (*MCPAuth)(nil)
	_ caddyhttp.MiddlewareHandler = (*MCPAuth)(nil)
	_ caddyfile.Unmarshaler       = (*MCPAuth)(nil)
	_                             = errors.New
)
