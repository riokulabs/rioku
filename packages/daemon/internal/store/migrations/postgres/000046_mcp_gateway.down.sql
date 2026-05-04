DROP TABLE IF EXISTS mcp_routes;
DROP INDEX IF EXISTS idx_api_keys_mcp_team;
ALTER TABLE api_keys DROP COLUMN mcp_team_id;
DROP TABLE IF EXISTS mcp_team_permissions;
DROP TABLE IF EXISTS mcp_teams;
