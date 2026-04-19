/**
 * Shared AI badge components — thin Mantine Badge wrappers.
 *
 * Pattern mirrors `api-mgmt-shared/protocol-badge.tsx`: enum → color + label,
 * no style wrappers (no wrappers rule B3).
 */
import { Badge } from '@mantine/core';
import type { AiProvider, AiTool, McpServer } from '@/api/resources/types';

// ─── ProviderKindBadge ────────────────────────────────────────────────────────

interface ProviderKindBadgeProps {
  kind: AiProvider['kind'];
}

const PROVIDER_KIND_COLORS: Record<AiProvider['kind'], string> = {
  openai: 'teal',
  anthropic: 'orange',
  gemini: 'blue',
  ollama: 'violet',
  custom: 'gray',
};

const PROVIDER_KIND_LABELS: Record<AiProvider['kind'], string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
  ollama: 'Ollama',
  custom: 'Custom',
};

export function ProviderKindBadge({ kind }: ProviderKindBadgeProps) {
  return (
    <Badge color={PROVIDER_KIND_COLORS[kind]} variant="light" size="sm">
      {PROVIDER_KIND_LABELS[kind]}
    </Badge>
  );
}

// ─── ToolKindBadge ────────────────────────────────────────────────────────────

interface ToolKindBadgeProps {
  kind: AiTool['kind'];
}

const TOOL_KIND_COLORS: Record<AiTool['kind'], string> = {
  native: 'green',
  mcp: 'indigo',
  http: 'cyan',
};

export function ToolKindBadge({ kind }: ToolKindBadgeProps) {
  return (
    <Badge color={TOOL_KIND_COLORS[kind]} variant="light" size="sm">
      {kind.toUpperCase()}
    </Badge>
  );
}

// ─── McpHealthChip ────────────────────────────────────────────────────────────

interface McpHealthChipProps {
  health: McpServer['health'];
}

const MCP_HEALTH_COLORS: Record<McpServer['health'], string> = {
  healthy: 'green',
  degraded: 'yellow',
  unreachable: 'red',
  disabled: 'gray',
};

export function McpHealthChip({ health }: McpHealthChipProps) {
  return (
    <Badge color={MCP_HEALTH_COLORS[health]} variant="light" size="sm">
      {health}
    </Badge>
  );
}

// ─── DangerousToolBadge ───────────────────────────────────────────────────────

export function DangerousToolBadge() {
  return (
    <Badge color="red" variant="filled" size="sm">
      Dangerous
    </Badge>
  );
}
