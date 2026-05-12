// Types for the ai-tools resource surface.

import type { ID } from './common';

export interface AiTool {
  readonly id: ID;
  readonly tenant_id: ID;
  name: string;
  description: string;
  /** JSON schema for tool input (JSON-schema draft-07). */
  schema: Record<string, unknown>;
  mcp_server_id?: ID;
  /** Handler kind — native = daemon-built-in, mcp = proxied via MCP server, http = call an external HTTP endpoint. */
  kind: 'native' | 'mcp' | 'http';
  /** Populated when kind === 'http'. */
  http_endpoint?: { url: string; method: 'GET' | 'POST'; auth_header?: string };
  /** Dangerous tools require explicit agent opt-in; flagged in the approval UI. */
  dangerous: boolean;
  enabled: boolean;
  readonly created_at: string;
}
