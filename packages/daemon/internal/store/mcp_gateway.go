package store

import (
	"errors"
	"time"
)

// MCP gateway v1 surface (Sprint 5 Phase 4, #181, D9).
//
// The MCP gateway lets agents discover and invoke tools from one
// or more upstream MCP servers via HTTP. Auth resolution chain in
// v1 is API-key -> MCPTeam -> allow-list of (server, tool). Agent
// identity is deferred to v3 per D9.
//
// MCPRoute is the inbound HTTP routing config: hostname/path -> MCP
// server URL. The Caddy compiler emits a reverse_proxy with the
// configured auth-passthrough rule.

// MCPTeamStatus enumerates the team lifecycle states.
type MCPTeamStatus string

const (
	MCPTeamStatusActive MCPTeamStatus = "active"
	MCPTeamStatusPaused MCPTeamStatus = "paused"
	MCPTeamStatusClosed MCPTeamStatus = "closed"
)

// MCPTeam is the v1 wrapper that binds API keys to a tool allow-list.
type MCPTeam struct {
	ID          string
	TenantID    string
	Name        string
	Description string
	Status      MCPTeamStatus
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

type CreateMCPTeamParams struct {
	ID          string
	TenantID    string
	Name        string
	Description string
	Status      MCPTeamStatus
}

type UpdateMCPTeamParams struct {
	Name        *string
	Description *string
	Status      *MCPTeamStatus
}

// MCPTeamPermission is one (server, tool) entry on a team's
// allow-list. Tool == "*" allows every tool the named server exposes.
type MCPTeamPermission struct {
	ID          string
	TenantID    string
	TeamID      string
	MCPServerID string
	ToolName    string
	CreatedAt   time.Time
}

// MCPAuthPassthrough governs how the inbound Authorization header
// is forwarded to the upstream MCP server.
type MCPAuthPassthrough string

const (
	// MCPAuthPassthroughForward sends the inbound Authorization
	// header to the MCP server unchanged. Default.
	MCPAuthPassthroughForward MCPAuthPassthrough = "forward"
	// MCPAuthPassthroughReplace rewrites the Authorization header
	// using the credential stored on the ai_mcp_servers row.
	MCPAuthPassthroughReplace MCPAuthPassthrough = "replace"
	// MCPAuthPassthroughStrip drops the Authorization header.
	// The MCP server sees an anonymous request.
	MCPAuthPassthroughStrip MCPAuthPassthrough = "strip"
)

// MCPRoute is the HTTP routing config in front of the MCP gateway.
type MCPRoute struct {
	ID              string
	TenantID        string
	Name            string
	Hostname        string
	PathPrefix      string
	MCPServerID     string
	AuthPassthrough MCPAuthPassthrough
	Enabled         bool
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

type CreateMCPRouteParams struct {
	ID              string
	TenantID        string
	Name            string
	Hostname        string
	PathPrefix      string
	MCPServerID     string
	AuthPassthrough MCPAuthPassthrough
	Enabled         bool
}

type UpdateMCPRouteParams struct {
	Name            *string
	Hostname        *string
	PathPrefix      *string
	MCPServerID     *string
	AuthPassthrough *MCPAuthPassthrough
	Enabled         *bool
}

// AllowsTool reports whether the team has a permission row that
// authorises calling toolName on the named MCP server. The caller
// passes in the team's permissions list (typically loaded once
// during the MCP gateway resolution step).
func AllowsTool(perms []*MCPTeamPermission, mcpServerID, toolName string) bool {
	for _, p := range perms {
		if p.MCPServerID != mcpServerID {
			continue
		}
		if p.ToolName == "*" || p.ToolName == toolName {
			return true
		}
	}
	return false
}

// Sentinel errors.
var (
	ErrMCPTeamNotFound       = errors.New("store: mcp_team not found")
	ErrMCPTeamNameTaken      = errors.New("store: mcp_team name already exists in tenant")
	ErrMCPTeamPermissionDup  = errors.New("store: mcp_team permission already exists")
	ErrMCPRouteNotFound      = errors.New("store: mcp_route not found")
	ErrMCPRouteHostPathTaken = errors.New("store: mcp_route host+path already exists in tenant")
)
