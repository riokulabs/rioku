/**
 * Feature-local types for MCP servers.
 */
export type { McpServer, AiTool, ID } from '@/api/resources';

import type { McpServer } from '@/api/resources';

export interface McpServerFilter {
  search: string;
  /** Restrict to these health states. Empty = no filter. */
  healths: McpServer['health'][];
  /** Restrict to these auth kinds. Empty = no filter. */
  auth_kinds: McpServer['auth_kind'][];
  /** true = only enabled, false = only disabled, undefined = all. */
  enabled?: boolean;
}

export interface CreateMcpServerInput {
  name: string;
  url: string;
  auth_kind: McpServer['auth_kind'];
  description?: string;
  /** Raw credential; prefix-only persisted. Optional when `auth_kind === 'none'`. */
  auth_credential?: string;
  authorized_agent_ids?: string[];
  enabled?: boolean;
}

export interface UpdateMcpServerInput {
  name?: string;
  url?: string;
  auth_kind?: McpServer['auth_kind'];
  description?: string;
  /** Raw credential; prefix-only persisted. */
  auth_credential?: string;
  authorized_agent_ids?: string[];
  enabled?: boolean;
}

export interface TestMcpServerResult {
  ok: boolean;
  latency_ms: number;
  /** Set when `ok === false`; daemon reports the underlying probe error. */
  error?: string;
  /** Captured from the upstream `Server` response header when present. */
  server_version?: string;
}
