// Types for the middlewares resource surface.

import type { ID } from './common';

export interface Middleware {
  readonly id: ID;
  readonly tenant_id: ID;
  name: string;
  kind: 'rate-limit' | 'auth' | 'transform' | 'cors' | 'cache' | 'logging' | 'custom';
  config: Record<string, unknown>;
  enabled: boolean;
  description?: string;
  order_hint: number;
  readonly created_at: string;
}
