// Package mysql — AI subsystem CRUD (stage-2).
//
// Seven entities: Providers, ProviderModels, MCPServers, Tools,
// Agents, ToolBindings, RateLimits, Traces.
package mysql

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/riokulabs/rioku/internal/store"
)

// ---------------------------------------------------------------------------
// AI Providers
// ---------------------------------------------------------------------------

func (t *tx) CreateAIProvider(ctx context.Context, in *store.AIProvider) (*store.AIProvider, error) {
	if in == nil || in.TenantID == "" || in.Name == "" || in.Kind == "" {
		return nil, fmt.Errorf("mysql: ai_provider requires tenant_id, name, kind")
	}
	id := in.ID
	if id == "" {
		id = newID("aiprov")
	}
	meta := in.Metadata
	if meta == "" {
		meta = "{}"
	}
	now := nowUTC()
	_, err := t.sqlTx.ExecContext(ctx,
		`INSERT INTO ai_providers (id, tenant_id, name, kind, base_url, credential, enabled, metadata, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, in.TenantID, in.Name, in.Kind, in.BaseURL, in.Credential,
		boolToInt(in.Enabled || in.Name != ""), meta, now, now,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, store.ErrAIProviderNameTaken
		}
		return nil, fmt.Errorf("mysql: insert ai_provider: %w", err)
	}
	t.emit("ai_providers", id, "INSERT")
	return t.GetAIProvider(ctx, in.TenantID, id)
}

func (t *tx) GetAIProvider(ctx context.Context, tenantID, id string) (*store.AIProvider, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, tenant_id, name, kind, base_url, credential, enabled, metadata, created_at, updated_at
		 FROM ai_providers WHERE id = ? AND tenant_id = ?`, id, tenantID)
	p, err := scanAIProvider(row)
	if err == sql.ErrNoRows {
		return nil, store.ErrAIProviderNotFound
	}
	return p, err
}

func (t *tx) ListAIProvidersByTenant(ctx context.Context, tenantID string) ([]*store.AIProvider, error) {
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT id, tenant_id, name, kind, base_url, credential, enabled, metadata, created_at, updated_at
		 FROM ai_providers WHERE tenant_id = ? ORDER BY name ASC`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("mysql: list ai_providers: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.AIProvider
	for rows.Next() {
		p, err := scanAIProvider(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (t *tx) UpdateAIProvider(ctx context.Context, tenantID, id string, p store.UpdateAIProviderParams) (*store.AIProvider, error) {
	c, err := t.GetAIProvider(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	if p.Name != nil {
		c.Name = *p.Name
	}
	if p.Kind != nil {
		c.Kind = *p.Kind
	}
	if p.BaseURL != nil {
		c.BaseURL = *p.BaseURL
	}
	if p.Credential != nil {
		c.Credential = p.Credential
	}
	if p.Enabled != nil {
		c.Enabled = *p.Enabled
	}
	if p.Metadata != nil {
		c.Metadata = *p.Metadata
	}
	now := nowUTC()
	if _, err := t.sqlTx.ExecContext(ctx,
		`UPDATE ai_providers SET name=?, kind=?, base_url=?, credential=?, enabled=?, metadata=?, updated_at=?
		 WHERE id=? AND tenant_id=?`,
		c.Name, c.Kind, c.BaseURL, c.Credential, boolToInt(c.Enabled), c.Metadata, now, id, tenantID); err != nil {
		if isUniqueViolation(err) {
			return nil, store.ErrAIProviderNameTaken
		}
		return nil, fmt.Errorf("mysql: update ai_provider: %w", err)
	}
	t.emit("ai_providers", id, "UPDATE")
	return t.GetAIProvider(ctx, tenantID, id)
}

func (t *tx) DeleteAIProvider(ctx context.Context, tenantID, id string) error {
	res, err := t.sqlTx.ExecContext(ctx, `DELETE FROM ai_providers WHERE id = ? AND tenant_id = ?`, id, tenantID)
	if err != nil {
		return fmt.Errorf("mysql: delete ai_provider: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return store.ErrAIProviderNotFound
	}
	t.emit("ai_providers", id, "DELETE")
	return nil
}

func scanAIProvider(s scanner) (*store.AIProvider, error) {
	var (
		id, tenantID, name, kind, baseURL, metadata, createdAt, updatedAt string
		credential                                                        *string
		enabled                                                           int
	)
	if err := s.Scan(&id, &tenantID, &name, &kind, &baseURL, &credential, &enabled, &metadata, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	return &store.AIProvider{
		ID: id, TenantID: tenantID, Name: name, Kind: kind, BaseURL: baseURL,
		Credential: credential, Enabled: enabled == 1, Metadata: metadata,
		CreatedAt: parseTime(createdAt), UpdatedAt: parseTime(updatedAt),
	}, nil
}

// ---------------------------------------------------------------------------
// AI Provider Models
// ---------------------------------------------------------------------------

func (t *tx) AddProviderModel(ctx context.Context, in *store.AIProviderModel) (*store.AIProviderModel, error) {
	if in == nil || in.ProviderID == "" || in.UpstreamModelID == "" || in.Alias == "" {
		return nil, fmt.Errorf("mysql: provider_model requires provider_id, upstream_model_id, alias")
	}
	id := in.ID
	if id == "" {
		id = newID("aimodel")
	}
	now := nowUTC()
	_, err := t.sqlTx.ExecContext(ctx,
		`INSERT INTO ai_provider_models (id, provider_id, upstream_model_id, alias, rate_limit_rpm, daily_quota_tokens, enabled, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, in.ProviderID, in.UpstreamModelID, in.Alias, in.RateLimitRPM, in.DailyQuotaTokens, boolToInt(in.Enabled), now, now,
	)
	if err != nil {
		return nil, fmt.Errorf("mysql: insert provider_model: %w", err)
	}
	t.emit("ai_provider_models", id, "INSERT")
	return t.getProviderModel(ctx, id)
}

func (t *tx) getProviderModel(ctx context.Context, id string) (*store.AIProviderModel, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, provider_id, upstream_model_id, alias, rate_limit_rpm, daily_quota_tokens, enabled, created_at, updated_at
		 FROM ai_provider_models WHERE id = ?`, id)
	m, err := scanProviderModel(row)
	if err == sql.ErrNoRows {
		return nil, store.ErrAIProviderModelNotFound
	}
	return m, err
}

func (t *tx) UpdateProviderModel(ctx context.Context, providerID, modelID string, p store.UpdateAIProviderModelParams) (*store.AIProviderModel, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, provider_id, upstream_model_id, alias, rate_limit_rpm, daily_quota_tokens, enabled, created_at, updated_at
		 FROM ai_provider_models WHERE id = ? AND provider_id = ?`, modelID, providerID)
	c, err := scanProviderModel(row)
	if err == sql.ErrNoRows {
		return nil, store.ErrAIProviderModelNotFound
	}
	if err != nil {
		return nil, err
	}
	if p.Alias != nil {
		c.Alias = *p.Alias
	}
	if p.RateLimitRPM != nil {
		c.RateLimitRPM = *p.RateLimitRPM
	}
	if p.DailyQuotaTokens != nil {
		c.DailyQuotaTokens = *p.DailyQuotaTokens
	}
	if p.Enabled != nil {
		c.Enabled = *p.Enabled
	}
	if _, err := t.sqlTx.ExecContext(ctx,
		`UPDATE ai_provider_models SET alias=?, rate_limit_rpm=?, daily_quota_tokens=?, enabled=?, updated_at=?
		 WHERE id=? AND provider_id=?`,
		c.Alias, c.RateLimitRPM, c.DailyQuotaTokens, boolToInt(c.Enabled), nowUTC(), modelID, providerID); err != nil {
		return nil, fmt.Errorf("mysql: update provider_model: %w", err)
	}
	t.emit("ai_provider_models", modelID, "UPDATE")
	return t.getProviderModel(ctx, modelID)
}

func (t *tx) RemoveProviderModel(ctx context.Context, providerID, modelID string) error {
	res, err := t.sqlTx.ExecContext(ctx,
		`DELETE FROM ai_provider_models WHERE id = ? AND provider_id = ?`, modelID, providerID)
	if err != nil {
		return fmt.Errorf("mysql: delete provider_model: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return store.ErrAIProviderModelNotFound
	}
	t.emit("ai_provider_models", modelID, "DELETE")
	return nil
}

func (t *tx) ListProviderModels(ctx context.Context, providerID string) ([]*store.AIProviderModel, error) {
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT id, provider_id, upstream_model_id, alias, rate_limit_rpm, daily_quota_tokens, enabled, created_at, updated_at
		 FROM ai_provider_models WHERE provider_id = ? ORDER BY alias ASC`, providerID)
	if err != nil {
		return nil, fmt.Errorf("mysql: list provider_models: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.AIProviderModel
	for rows.Next() {
		m, err := scanProviderModel(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func scanProviderModel(s scanner) (*store.AIProviderModel, error) {
	var (
		id, providerID, upstreamID, alias, createdAt, updatedAt string
		rateLimitRPM                                            int32
		dailyQuota                                              int64
		enabled                                                 int
	)
	if err := s.Scan(&id, &providerID, &upstreamID, &alias, &rateLimitRPM, &dailyQuota, &enabled, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	return &store.AIProviderModel{
		ID: id, ProviderID: providerID, UpstreamModelID: upstreamID, Alias: alias,
		RateLimitRPM: rateLimitRPM, DailyQuotaTokens: dailyQuota, Enabled: enabled == 1,
		CreatedAt: parseTime(createdAt), UpdatedAt: parseTime(updatedAt),
	}, nil
}

// ---------------------------------------------------------------------------
// MCP Servers
// ---------------------------------------------------------------------------

func (t *tx) CreateMCPServer(ctx context.Context, in *store.AIMCPServer) (*store.AIMCPServer, error) {
	if in == nil || in.TenantID == "" || in.Name == "" || in.URL == "" {
		return nil, fmt.Errorf("mysql: mcp_server requires tenant_id, name, url")
	}
	id := in.ID
	if id == "" {
		id = newID("mcp")
	}
	authKind := in.AuthKind
	if authKind == "" {
		authKind = "none"
	}
	health := in.Health
	if health == "" {
		health = "disabled"
	}
	authorized := in.AuthorizedAgentIDs
	if authorized == "" {
		authorized = "[]"
	}
	now := nowUTC()
	_, err := t.sqlTx.ExecContext(ctx,
		`INSERT INTO ai_mcp_servers (id, tenant_id, name, url, auth_kind, auth_credential, health, enabled,
		   authorized_agent_ids, last_checked_at, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, in.TenantID, in.Name, in.URL, authKind, in.AuthCredential, health, boolToInt(in.Enabled),
		authorized, formatNullableTime(in.LastCheckedAt), now, now,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, store.ErrMCPServerNameTaken
		}
		return nil, fmt.Errorf("mysql: insert mcp_server: %w", err)
	}
	t.emit("ai_mcp_servers", id, "INSERT")
	return t.GetMCPServer(ctx, in.TenantID, id)
}

func (t *tx) GetMCPServer(ctx context.Context, tenantID, id string) (*store.AIMCPServer, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, tenant_id, name, url, auth_kind, auth_credential, health, enabled,
		   authorized_agent_ids, last_checked_at, created_at, updated_at
		 FROM ai_mcp_servers WHERE id = ? AND tenant_id = ?`, id, tenantID)
	s, err := scanMCPServer(row)
	if err == sql.ErrNoRows {
		return nil, store.ErrMCPServerNotFound
	}
	return s, err
}

func (t *tx) ListMCPServersByTenant(ctx context.Context, tenantID string) ([]*store.AIMCPServer, error) {
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT id, tenant_id, name, url, auth_kind, auth_credential, health, enabled,
		   authorized_agent_ids, last_checked_at, created_at, updated_at
		 FROM ai_mcp_servers WHERE tenant_id = ? ORDER BY name ASC`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("mysql: list mcp_servers: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.AIMCPServer
	for rows.Next() {
		s, err := scanMCPServer(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (t *tx) UpdateMCPServer(ctx context.Context, tenantID, id string, p store.UpdateAIMCPServerParams) (*store.AIMCPServer, error) {
	c, err := t.GetMCPServer(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	if p.Name != nil {
		c.Name = *p.Name
	}
	if p.URL != nil {
		c.URL = *p.URL
	}
	if p.AuthKind != nil {
		c.AuthKind = *p.AuthKind
	}
	if p.AuthCredential != nil {
		c.AuthCredential = p.AuthCredential
	}
	if p.Health != nil {
		c.Health = *p.Health
	}
	if p.Enabled != nil {
		c.Enabled = *p.Enabled
	}
	if p.AuthorizedAgentIDs != nil {
		c.AuthorizedAgentIDs = *p.AuthorizedAgentIDs
	}
	if p.LastCheckedAt != nil {
		c.LastCheckedAt = p.LastCheckedAt
	}
	if _, err := t.sqlTx.ExecContext(ctx,
		`UPDATE ai_mcp_servers SET name=?, url=?, auth_kind=?, auth_credential=?, health=?, enabled=?,
		   authorized_agent_ids=?, last_checked_at=?, updated_at=?
		 WHERE id=? AND tenant_id=?`,
		c.Name, c.URL, c.AuthKind, c.AuthCredential, c.Health, boolToInt(c.Enabled),
		c.AuthorizedAgentIDs, formatNullableTime(c.LastCheckedAt), nowUTC(), id, tenantID); err != nil {
		if isUniqueViolation(err) {
			return nil, store.ErrMCPServerNameTaken
		}
		return nil, fmt.Errorf("mysql: update mcp_server: %w", err)
	}
	t.emit("ai_mcp_servers", id, "UPDATE")
	return t.GetMCPServer(ctx, tenantID, id)
}

func (t *tx) DeleteMCPServer(ctx context.Context, tenantID, id string) error {
	res, err := t.sqlTx.ExecContext(ctx, `DELETE FROM ai_mcp_servers WHERE id = ? AND tenant_id = ?`, id, tenantID)
	if err != nil {
		return fmt.Errorf("mysql: delete mcp_server: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return store.ErrMCPServerNotFound
	}
	t.emit("ai_mcp_servers", id, "DELETE")
	return nil
}

func scanMCPServer(s scanner) (*store.AIMCPServer, error) {
	var (
		id, tenantID, name, url, authKind, health, authorized, createdAt, updatedAt string
		authCredential, lastCheckedAt                                               *string
		enabled                                                                     int
	)
	if err := s.Scan(&id, &tenantID, &name, &url, &authKind, &authCredential, &health, &enabled,
		&authorized, &lastCheckedAt, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	out := &store.AIMCPServer{
		ID: id, TenantID: tenantID, Name: name, URL: url, AuthKind: authKind,
		AuthCredential: authCredential, Health: health, Enabled: enabled == 1,
		AuthorizedAgentIDs: authorized,
		CreatedAt:          parseTime(createdAt), UpdatedAt: parseTime(updatedAt),
	}
	if lastCheckedAt != nil {
		ts := parseTime(*lastCheckedAt)
		out.LastCheckedAt = &ts
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// AI Tools
// ---------------------------------------------------------------------------

func (t *tx) CreateAITool(ctx context.Context, in *store.AITool) (*store.AITool, error) {
	if in == nil || in.TenantID == "" || in.Name == "" || in.Kind == "" {
		return nil, fmt.Errorf("mysql: ai_tool requires tenant_id, name, kind")
	}
	id := in.ID
	if id == "" {
		id = newID("aitool")
	}
	schemaJSON := in.SchemaJSON
	if schemaJSON == "" {
		schemaJSON = "{}"
	}
	now := nowUTC()
	_, err := t.sqlTx.ExecContext(ctx,
		`INSERT INTO ai_tools (id, tenant_id, name, kind, description, schema_json, http_endpoint, mcp_server_id,
		   dangerous, enabled, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, in.TenantID, in.Name, in.Kind, in.Description, schemaJSON, in.HTTPEndpoint, in.MCPServerID,
		boolToInt(in.Dangerous), boolToInt(in.Enabled), now, now,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, store.ErrAIToolNameTaken
		}
		return nil, fmt.Errorf("mysql: insert ai_tool: %w", err)
	}
	t.emit("ai_tools", id, "INSERT")
	return t.GetAITool(ctx, in.TenantID, id)
}

func (t *tx) GetAITool(ctx context.Context, tenantID, id string) (*store.AITool, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, tenant_id, name, kind, description, schema_json, http_endpoint, mcp_server_id,
		   dangerous, enabled, created_at, updated_at
		 FROM ai_tools WHERE id = ? AND tenant_id = ?`, id, tenantID)
	x, err := scanAITool(row)
	if err == sql.ErrNoRows {
		return nil, store.ErrAIToolNotFound
	}
	return x, err
}

func (t *tx) ListAIToolsByTenant(ctx context.Context, tenantID string) ([]*store.AITool, error) {
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT id, tenant_id, name, kind, description, schema_json, http_endpoint, mcp_server_id,
		   dangerous, enabled, created_at, updated_at
		 FROM ai_tools WHERE tenant_id = ? ORDER BY name ASC`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("mysql: list ai_tools: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.AITool
	for rows.Next() {
		x, err := scanAITool(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

func (t *tx) UpdateAITool(ctx context.Context, tenantID, id string, p store.UpdateAIToolParams) (*store.AITool, error) {
	c, err := t.GetAITool(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	if p.Name != nil {
		c.Name = *p.Name
	}
	if p.Kind != nil {
		c.Kind = *p.Kind
	}
	if p.Description != nil {
		c.Description = *p.Description
	}
	if p.SchemaJSON != nil {
		c.SchemaJSON = *p.SchemaJSON
	}
	if p.HTTPEndpoint != nil {
		c.HTTPEndpoint = p.HTTPEndpoint
	}
	if p.MCPServerID != nil {
		c.MCPServerID = p.MCPServerID
	}
	if p.Dangerous != nil {
		c.Dangerous = *p.Dangerous
	}
	if p.Enabled != nil {
		c.Enabled = *p.Enabled
	}
	if _, err := t.sqlTx.ExecContext(ctx,
		`UPDATE ai_tools SET name=?, kind=?, description=?, schema_json=?, http_endpoint=?, mcp_server_id=?,
		   dangerous=?, enabled=?, updated_at=?
		 WHERE id=? AND tenant_id=?`,
		c.Name, c.Kind, c.Description, c.SchemaJSON, c.HTTPEndpoint, c.MCPServerID,
		boolToInt(c.Dangerous), boolToInt(c.Enabled), nowUTC(), id, tenantID); err != nil {
		if isUniqueViolation(err) {
			return nil, store.ErrAIToolNameTaken
		}
		return nil, fmt.Errorf("mysql: update ai_tool: %w", err)
	}
	t.emit("ai_tools", id, "UPDATE")
	return t.GetAITool(ctx, tenantID, id)
}

func (t *tx) DeleteAITool(ctx context.Context, tenantID, id string) error {
	res, err := t.sqlTx.ExecContext(ctx, `DELETE FROM ai_tools WHERE id = ? AND tenant_id = ?`, id, tenantID)
	if err != nil {
		return fmt.Errorf("mysql: delete ai_tool: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return store.ErrAIToolNotFound
	}
	t.emit("ai_tools", id, "DELETE")
	return nil
}

func scanAITool(s scanner) (*store.AITool, error) {
	var (
		id, tenantID, name, kind, description, schemaJSON, createdAt, updatedAt string
		httpEndpoint, mcpServerID                                               *string
		dangerous, enabled                                                      int
	)
	if err := s.Scan(&id, &tenantID, &name, &kind, &description, &schemaJSON, &httpEndpoint, &mcpServerID,
		&dangerous, &enabled, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	return &store.AITool{
		ID: id, TenantID: tenantID, Name: name, Kind: kind, Description: description,
		SchemaJSON: schemaJSON, HTTPEndpoint: httpEndpoint, MCPServerID: mcpServerID,
		Dangerous: dangerous == 1, Enabled: enabled == 1,
		CreatedAt: parseTime(createdAt), UpdatedAt: parseTime(updatedAt),
	}, nil
}

// ---------------------------------------------------------------------------
// AI Agents
// ---------------------------------------------------------------------------

func (t *tx) CreateAIAgent(ctx context.Context, in *store.AIAgent) (*store.AIAgent, error) {
	if in == nil || in.TenantID == "" || in.Name == "" {
		return nil, fmt.Errorf("mysql: ai_agent requires tenant_id, name")
	}
	id := in.ID
	if id == "" {
		id = newID("aiagent")
	}
	guard := in.Guardrails
	if guard == "" {
		guard = "{}"
	}
	now := nowUTC()
	_, err := t.sqlTx.ExecContext(ctx,
		`INSERT INTO ai_agents (id, tenant_id, provider_id, name, description, model, system_prompt, guardrails,
		   scoped_credential, enabled, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, in.TenantID, in.ProviderID, in.Name, in.Description, in.Model, in.SystemPrompt, guard,
		in.ScopedCredential, boolToInt(in.Enabled), now, now,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, store.ErrAIAgentNameTaken
		}
		return nil, fmt.Errorf("mysql: insert ai_agent: %w", err)
	}
	t.emit("ai_agents", id, "INSERT")
	return t.GetAIAgent(ctx, in.TenantID, id)
}

func (t *tx) GetAIAgent(ctx context.Context, tenantID, id string) (*store.AIAgent, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, tenant_id, provider_id, name, description, model, system_prompt, guardrails,
		   scoped_credential, enabled, created_at, updated_at
		 FROM ai_agents WHERE id = ? AND tenant_id = ?`, id, tenantID)
	a, err := scanAIAgent(row)
	if err == sql.ErrNoRows {
		return nil, store.ErrAIAgentNotFound
	}
	return a, err
}

func (t *tx) ListAIAgentsByTenant(ctx context.Context, tenantID string) ([]*store.AIAgent, error) {
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT id, tenant_id, provider_id, name, description, model, system_prompt, guardrails,
		   scoped_credential, enabled, created_at, updated_at
		 FROM ai_agents WHERE tenant_id = ? ORDER BY name ASC`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("mysql: list ai_agents: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.AIAgent
	for rows.Next() {
		a, err := scanAIAgent(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (t *tx) UpdateAIAgent(ctx context.Context, tenantID, id string, p store.UpdateAIAgentParams) (*store.AIAgent, error) {
	c, err := t.GetAIAgent(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	if p.ProviderID != nil {
		c.ProviderID = p.ProviderID
	}
	if p.Name != nil {
		c.Name = *p.Name
	}
	if p.Description != nil {
		c.Description = *p.Description
	}
	if p.Model != nil {
		c.Model = *p.Model
	}
	if p.SystemPrompt != nil {
		c.SystemPrompt = *p.SystemPrompt
	}
	if p.Guardrails != nil {
		c.Guardrails = *p.Guardrails
	}
	if p.ScopedCredential != nil {
		c.ScopedCredential = p.ScopedCredential
	}
	if p.Enabled != nil {
		c.Enabled = *p.Enabled
	}
	if _, err := t.sqlTx.ExecContext(ctx,
		`UPDATE ai_agents SET provider_id=?, name=?, description=?, model=?, system_prompt=?, guardrails=?,
		   scoped_credential=?, enabled=?, updated_at=?
		 WHERE id=? AND tenant_id=?`,
		c.ProviderID, c.Name, c.Description, c.Model, c.SystemPrompt, c.Guardrails,
		c.ScopedCredential, boolToInt(c.Enabled), nowUTC(), id, tenantID); err != nil {
		if isUniqueViolation(err) {
			return nil, store.ErrAIAgentNameTaken
		}
		return nil, fmt.Errorf("mysql: update ai_agent: %w", err)
	}
	t.emit("ai_agents", id, "UPDATE")
	return t.GetAIAgent(ctx, tenantID, id)
}

func (t *tx) DeleteAIAgent(ctx context.Context, tenantID, id string) error {
	res, err := t.sqlTx.ExecContext(ctx, `DELETE FROM ai_agents WHERE id = ? AND tenant_id = ?`, id, tenantID)
	if err != nil {
		return fmt.Errorf("mysql: delete ai_agent: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return store.ErrAIAgentNotFound
	}
	t.emit("ai_agents", id, "DELETE")
	return nil
}

func scanAIAgent(s scanner) (*store.AIAgent, error) {
	var (
		id, tenantID, name, description, model, systemPrompt, guardrails, createdAt, updatedAt string
		providerID, scopedCred                                                                 *string
		enabled                                                                                int
	)
	if err := s.Scan(&id, &tenantID, &providerID, &name, &description, &model, &systemPrompt, &guardrails,
		&scopedCred, &enabled, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	return &store.AIAgent{
		ID: id, TenantID: tenantID, ProviderID: providerID, Name: name, Description: description,
		Model: model, SystemPrompt: systemPrompt, Guardrails: guardrails,
		ScopedCredential: scopedCred, Enabled: enabled == 1,
		CreatedAt: parseTime(createdAt), UpdatedAt: parseTime(updatedAt),
	}, nil
}

// ---------------------------------------------------------------------------
// AI Tool Bindings
// ---------------------------------------------------------------------------

func (t *tx) CreateAIToolBinding(ctx context.Context, in *store.AIToolBinding) (*store.AIToolBinding, error) {
	if in == nil || in.TenantID == "" || in.AgentID == "" || in.ToolID == "" {
		return nil, fmt.Errorf("mysql: tool_binding requires tenant_id, agent_id, tool_id")
	}
	id := in.ID
	if id == "" {
		id = newID("aibind")
	}
	now := nowUTC()
	_, err := t.sqlTx.ExecContext(ctx,
		`INSERT INTO ai_tool_bindings (id, tenant_id, agent_id, tool_id, condition, enabled, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		id, in.TenantID, in.AgentID, in.ToolID, in.Condition, boolToInt(in.Enabled), now, now,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, store.ErrAIBindingExists
		}
		return nil, fmt.Errorf("mysql: insert tool_binding: %w", err)
	}
	t.emit("ai_tool_bindings", id, "INSERT")
	return t.GetAIToolBinding(ctx, in.TenantID, id)
}

func (t *tx) GetAIToolBinding(ctx context.Context, tenantID, id string) (*store.AIToolBinding, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, tenant_id, agent_id, tool_id, condition, enabled, created_at, updated_at
		 FROM ai_tool_bindings WHERE id = ? AND tenant_id = ?`, id, tenantID)
	b, err := scanAIToolBinding(row)
	if err == sql.ErrNoRows {
		return nil, store.ErrAIBindingNotFound
	}
	return b, err
}

func (t *tx) ListAIToolBindingsByTenant(ctx context.Context, tenantID string) ([]*store.AIToolBinding, error) {
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT id, tenant_id, agent_id, tool_id, condition, enabled, created_at, updated_at
		 FROM ai_tool_bindings WHERE tenant_id = ? ORDER BY created_at ASC`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("mysql: list tool_bindings: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.AIToolBinding
	for rows.Next() {
		b, err := scanAIToolBinding(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

func (t *tx) ListAIToolBindingsByAgent(ctx context.Context, agentID string) ([]*store.AIToolBinding, error) {
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT id, tenant_id, agent_id, tool_id, condition, enabled, created_at, updated_at
		 FROM ai_tool_bindings WHERE agent_id = ? ORDER BY created_at ASC`, agentID)
	if err != nil {
		return nil, fmt.Errorf("mysql: list tool_bindings_by_agent: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.AIToolBinding
	for rows.Next() {
		b, err := scanAIToolBinding(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

func (t *tx) UpdateAIToolBinding(ctx context.Context, tenantID, id string, p store.UpdateAIToolBindingParams) (*store.AIToolBinding, error) {
	c, err := t.GetAIToolBinding(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	if p.Condition != nil {
		c.Condition = *p.Condition
	}
	if p.Enabled != nil {
		c.Enabled = *p.Enabled
	}
	if _, err := t.sqlTx.ExecContext(ctx,
		`UPDATE ai_tool_bindings SET condition=?, enabled=?, updated_at=?
		 WHERE id=? AND tenant_id=?`,
		c.Condition, boolToInt(c.Enabled), nowUTC(), id, tenantID); err != nil {
		return nil, fmt.Errorf("mysql: update tool_binding: %w", err)
	}
	t.emit("ai_tool_bindings", id, "UPDATE")
	return t.GetAIToolBinding(ctx, tenantID, id)
}

func (t *tx) DeleteAIToolBinding(ctx context.Context, tenantID, id string) error {
	res, err := t.sqlTx.ExecContext(ctx, `DELETE FROM ai_tool_bindings WHERE id = ? AND tenant_id = ?`, id, tenantID)
	if err != nil {
		return fmt.Errorf("mysql: delete tool_binding: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return store.ErrAIBindingNotFound
	}
	t.emit("ai_tool_bindings", id, "DELETE")
	return nil
}

func scanAIToolBinding(s scanner) (*store.AIToolBinding, error) {
	var (
		id, tenantID, agentID, toolID, condition, createdAt, updatedAt string
		enabled                                                        int
	)
	if err := s.Scan(&id, &tenantID, &agentID, &toolID, &condition, &enabled, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	return &store.AIToolBinding{
		ID: id, TenantID: tenantID, AgentID: agentID, ToolID: toolID, Condition: condition,
		Enabled: enabled == 1, CreatedAt: parseTime(createdAt), UpdatedAt: parseTime(updatedAt),
	}, nil
}

// ---------------------------------------------------------------------------
// AI Semantic Rate Limits
// ---------------------------------------------------------------------------

func (t *tx) CreateAIRateLimit(ctx context.Context, in *store.AISemanticRateLimit) (*store.AISemanticRateLimit, error) {
	if in == nil || in.TenantID == "" || in.Name == "" || in.Scope == "" {
		return nil, fmt.Errorf("mysql: rate_limit requires tenant_id, name, scope")
	}
	id := in.ID
	if id == "" {
		id = newID("airl")
	}
	exemplars := in.Exemplars
	if exemplars == "" {
		exemplars = "[]"
	}
	action := in.Action
	if action == "" {
		action = "block"
	}
	now := nowUTC()
	_, err := t.sqlTx.ExecContext(ctx,
		`INSERT INTO ai_semantic_rate_limits (id, tenant_id, name, scope, agent_id, tool_id, exemplars,
		   similarity_threshold, window_seconds, threshold, action, enabled, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, in.TenantID, in.Name, in.Scope, in.AgentID, in.ToolID, exemplars,
		in.SimilarityThreshold, in.WindowSeconds, in.Threshold, action, boolToInt(in.Enabled), now, now,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, store.ErrAIRateLimitNameTaken
		}
		return nil, fmt.Errorf("mysql: insert rate_limit: %w", err)
	}
	t.emit("ai_semantic_rate_limits", id, "INSERT")
	return t.GetAIRateLimit(ctx, in.TenantID, id)
}

func (t *tx) GetAIRateLimit(ctx context.Context, tenantID, id string) (*store.AISemanticRateLimit, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, tenant_id, name, scope, agent_id, tool_id, exemplars,
		   similarity_threshold, window_seconds, threshold, action, enabled, created_at, updated_at
		 FROM ai_semantic_rate_limits WHERE id = ? AND tenant_id = ?`, id, tenantID)
	rl, err := scanAIRateLimit(row)
	if err == sql.ErrNoRows {
		return nil, store.ErrAIRateLimitNotFound
	}
	return rl, err
}

func (t *tx) ListAIRateLimitsByTenant(ctx context.Context, tenantID string) ([]*store.AISemanticRateLimit, error) {
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT id, tenant_id, name, scope, agent_id, tool_id, exemplars,
		   similarity_threshold, window_seconds, threshold, action, enabled, created_at, updated_at
		 FROM ai_semantic_rate_limits WHERE tenant_id = ? ORDER BY name ASC`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("mysql: list rate_limits: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.AISemanticRateLimit
	for rows.Next() {
		rl, err := scanAIRateLimit(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, rl)
	}
	return out, rows.Err()
}

func (t *tx) UpdateAIRateLimit(ctx context.Context, tenantID, id string, p store.UpdateAIRateLimitParams) (*store.AISemanticRateLimit, error) {
	c, err := t.GetAIRateLimit(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	if p.Name != nil {
		c.Name = *p.Name
	}
	if p.Scope != nil {
		c.Scope = *p.Scope
	}
	if p.AgentID != nil {
		c.AgentID = p.AgentID
	}
	if p.ToolID != nil {
		c.ToolID = p.ToolID
	}
	if p.Exemplars != nil {
		c.Exemplars = *p.Exemplars
	}
	if p.SimilarityThreshold != nil {
		c.SimilarityThreshold = *p.SimilarityThreshold
	}
	if p.WindowSeconds != nil {
		c.WindowSeconds = *p.WindowSeconds
	}
	if p.Threshold != nil {
		c.Threshold = *p.Threshold
	}
	if p.Action != nil {
		c.Action = *p.Action
	}
	if p.Enabled != nil {
		c.Enabled = *p.Enabled
	}
	if _, err := t.sqlTx.ExecContext(ctx,
		`UPDATE ai_semantic_rate_limits SET name=?, scope=?, agent_id=?, tool_id=?, exemplars=?,
		   similarity_threshold=?, window_seconds=?, threshold=?, action=?, enabled=?, updated_at=?
		 WHERE id=? AND tenant_id=?`,
		c.Name, c.Scope, c.AgentID, c.ToolID, c.Exemplars,
		c.SimilarityThreshold, c.WindowSeconds, c.Threshold, c.Action, boolToInt(c.Enabled), nowUTC(),
		id, tenantID); err != nil {
		if isUniqueViolation(err) {
			return nil, store.ErrAIRateLimitNameTaken
		}
		return nil, fmt.Errorf("mysql: update rate_limit: %w", err)
	}
	t.emit("ai_semantic_rate_limits", id, "UPDATE")
	return t.GetAIRateLimit(ctx, tenantID, id)
}

func (t *tx) DeleteAIRateLimit(ctx context.Context, tenantID, id string) error {
	res, err := t.sqlTx.ExecContext(ctx, `DELETE FROM ai_semantic_rate_limits WHERE id = ? AND tenant_id = ?`, id, tenantID)
	if err != nil {
		return fmt.Errorf("mysql: delete rate_limit: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return store.ErrAIRateLimitNotFound
	}
	t.emit("ai_semantic_rate_limits", id, "DELETE")
	return nil
}

func scanAIRateLimit(s scanner) (*store.AISemanticRateLimit, error) {
	var (
		id, tenantID, name, scope, exemplars, action, createdAt, updatedAt string
		agentID, toolID                                                    *string
		simThreshold                                                       float64
		windowSec, threshold                                               int32
		enabled                                                            int
	)
	if err := s.Scan(&id, &tenantID, &name, &scope, &agentID, &toolID, &exemplars,
		&simThreshold, &windowSec, &threshold, &action, &enabled, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	return &store.AISemanticRateLimit{
		ID: id, TenantID: tenantID, Name: name, Scope: scope, AgentID: agentID, ToolID: toolID,
		Exemplars: exemplars, SimilarityThreshold: simThreshold, WindowSeconds: windowSec,
		Threshold: threshold, Action: action, Enabled: enabled == 1,
		CreatedAt: parseTime(createdAt), UpdatedAt: parseTime(updatedAt),
	}, nil
}

// ---------------------------------------------------------------------------
// AI Traces (append-only)
// ---------------------------------------------------------------------------

func (t *tx) AppendAITrace(ctx context.Context, in *store.AITrace) (*store.AITrace, error) {
	if in == nil || in.TenantID == "" || in.Status == "" {
		return nil, fmt.Errorf("mysql: trace requires tenant_id, status")
	}
	id := in.ID
	if id == "" {
		id = newID("aitrace")
	}
	calls := in.ToolCallsJSON
	if calls == "" {
		calls = "[]"
	}
	now := nowUTC()
	occurred := now
	if !in.OccurredAt.IsZero() {
		occurred = in.OccurredAt.UTC().Format(timeFormat)
	}
	_, err := t.sqlTx.ExecContext(ctx,
		`INSERT INTO ai_traces (id, tenant_id, agent_id, provider_id, model, status, input_tokens,
		   output_tokens, duration_ms, prompt, completion, tool_calls_json, error, occurred_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, in.TenantID, in.AgentID, in.ProviderID, in.Model, in.Status, in.InputTokens,
		in.OutputTokens, in.DurationMS, in.Prompt, in.Completion, calls, in.Error, occurred,
	)
	if err != nil {
		return nil, fmt.Errorf("mysql: insert trace: %w", err)
	}
	t.emit("ai_traces", id, "INSERT")
	return t.GetAITrace(ctx, in.TenantID, id)
}

func (t *tx) GetAITrace(ctx context.Context, tenantID, id string) (*store.AITrace, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, tenant_id, agent_id, provider_id, model, status, input_tokens,
		   output_tokens, duration_ms, prompt, completion, tool_calls_json, error, occurred_at
		 FROM ai_traces WHERE id = ? AND tenant_id = ?`, id, tenantID)
	tr, err := scanAITrace(row)
	if err == sql.ErrNoRows {
		return nil, store.ErrAITraceNotFound
	}
	return tr, err
}

func (t *tx) ListAITracesByTenant(ctx context.Context, tenantID string, q store.AITraceQuery) ([]*store.AITrace, error) {
	return t.queryAITraces(ctx, q, "tenant_id = ?", tenantID)
}

func (t *tx) ListAITracesByAgent(ctx context.Context, agentID string, q store.AITraceQuery) ([]*store.AITrace, error) {
	return t.queryAITraces(ctx, q, "agent_id = ?", agentID)
}

func (t *tx) queryAITraces(ctx context.Context, q store.AITraceQuery, whereClause string, whereArg any) ([]*store.AITrace, error) {
	sqlStr := `SELECT id, tenant_id, agent_id, provider_id, model, status, input_tokens,
		   output_tokens, duration_ms, prompt, completion, tool_calls_json, error, occurred_at
		 FROM ai_traces WHERE ` + whereClause
	args := []any{whereArg}
	if q.Status != nil && *q.Status != "" {
		sqlStr += ` AND status = ?`
		args = append(args, *q.Status)
	}
	if q.Since != nil {
		sqlStr += ` AND occurred_at >= ?`
		args = append(args, q.Since.UTC().Format(timeFormat))
	}
	if q.Until != nil {
		sqlStr += ` AND occurred_at <= ?`
		args = append(args, q.Until.UTC().Format(timeFormat))
	}
	sqlStr += ` ORDER BY occurred_at DESC, id DESC`
	limit := q.Limit
	if limit <= 0 || limit > 1000 {
		limit = 1000
	}
	sqlStr += ` LIMIT ?`
	args = append(args, limit)
	if q.Offset > 0 {
		sqlStr += ` OFFSET ?`
		args = append(args, q.Offset)
	}

	rows, err := t.sqlTx.QueryContext(ctx, sqlStr, args...)
	if err != nil {
		return nil, fmt.Errorf("mysql: query traces: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.AITrace
	for rows.Next() {
		tr, err := scanAITrace(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, tr)
	}
	return out, rows.Err()
}

func scanAITrace(s scanner) (*store.AITrace, error) {
	var (
		id, tenantID, model, status, calls, occurredAt  string
		agentID, providerID, prompt, completion, errStr *string
		inputTokens, outputTokens, durationMS           int32
	)
	if err := s.Scan(&id, &tenantID, &agentID, &providerID, &model, &status, &inputTokens,
		&outputTokens, &durationMS, &prompt, &completion, &calls, &errStr, &occurredAt); err != nil {
		return nil, err
	}
	return &store.AITrace{
		ID: id, TenantID: tenantID, AgentID: agentID, ProviderID: providerID, Model: model,
		Status: status, InputTokens: inputTokens, OutputTokens: outputTokens, DurationMS: durationMS,
		Prompt: prompt, Completion: completion, ToolCallsJSON: calls, Error: errStr,
		OccurredAt: parseTime(occurredAt),
	}, nil
}
