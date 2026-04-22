/**
 * Feature-local types for AI tools.
 */
export type { AiAgent, AiTool, AiToolBinding, ID } from '@/api/resources/types';

import type { AiTool } from '@/api/resources/types';

export interface ToolFilter {
  search: string;
  /** Restrict to these kinds. Empty = no filter. */
  kinds: AiTool['kind'][];
  /** true = only enabled, false = only disabled, undefined = all. */
  enabled?: boolean;
  /** true = only dangerous, false = non-dangerous, undefined = all. */
  dangerous?: boolean;
  /** Filter to tools on a specific MCP server. */
  mcp_server_id?: string;
}

export interface CreateToolInput {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  kind: AiTool['kind'];
  mcp_server_id?: string;
  http_endpoint?: {
    url: string;
    method: 'GET' | 'POST';
    auth_header?: string;
  };
  dangerous?: boolean;
  enabled?: boolean;
}

export interface UpdateToolInput {
  name?: string;
  description?: string;
  schema?: Record<string, unknown>;
  kind?: AiTool['kind'];
  mcp_server_id?: string;
  http_endpoint?: {
    url: string;
    method: 'GET' | 'POST';
    auth_header?: string;
  };
  dangerous?: boolean;
  enabled?: boolean;
}

export interface TestToolResult {
  ok: boolean;
  result?: unknown;
  error?: string;
}

export class ToolInUseError extends Error {
  readonly code = 'TOOL_IN_USE';
  readonly agentIds: string[];
  readonly bindingIds: string[];
  constructor(agentIds: string[], bindingIds: string[]) {
    super(
      `Tool cannot be deleted — ${String(agentIds.length)} agent(s) and ${String(bindingIds.length)} binding(s) reference it.`,
    );
    this.name = 'ToolInUseError';
    this.agentIds = agentIds;
    this.bindingIds = bindingIds;
  }
}
