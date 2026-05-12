// Types for the ai-mcp-servers resource surface.

import type { ID } from './common';

export interface McpServer {
  readonly id: ID;
  readonly tenant_id: ID;
  name: string;
  url: string;
  auth_kind: 'none' | 'bearer' | 'api-key';
  enabled: boolean;
  description?: string;
  /** Auth credential ref — stored prefix-only. */
  auth_credential_ref?: { prefix: string; created_at: string };
  /** Which agents are authorized to route tools through this server. Empty = all. */
  authorized_agent_ids: ID[];
  /** Last-seen health. */
  health: 'healthy' | 'degraded' | 'unreachable' | 'disabled';
  /** Tools exposed by this server (mock: populated from aiTools where mcp_server_id === id). */
  exposed_tool_count: number;
  readonly created_at: string;
  readonly last_seen_at?: string;
}
