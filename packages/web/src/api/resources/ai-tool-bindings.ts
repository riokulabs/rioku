// Types for the ai-tool-bindings resource surface.

import type { ID } from './common';

/**
 * Tool routing binding — controls which agent may invoke which tool, and under
 * what additional conditions (CEL expression, mirrors access-policy grammar).
 */
export interface AiToolBinding {
  readonly id: ID;
  readonly tenant_id: ID;
  agent_id: ID;
  tool_id: ID;
  /** Optional CEL condition — empty string = always allow. */
  condition: string;
  enabled: boolean;
  readonly created_at: string;
}
