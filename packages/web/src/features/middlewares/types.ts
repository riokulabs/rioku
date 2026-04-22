/**
 * Feature-local types for middlewares.
 */
export type { Middleware, ID } from '@/api/resources/types';

import type { Middleware } from '@/api/resources/types';

export interface MiddlewareFilter {
  search: string;
  kind: 'all' | Middleware['kind'];
  enabled: 'all' | 'enabled' | 'disabled';
}

export interface MiddlewareInput {
  name: string;
  kind: Middleware['kind'];
  description?: string;
  config: Record<string, unknown>;
  enabled?: boolean;
  order_hint?: number;
}

export type MiddlewareUpdateInput = Partial<MiddlewareInput>;

export class MiddlewareInUseError extends Error {
  readonly code = 'MIDDLEWARE_IN_USE';
  readonly routeIds: string[];
  constructor(routeIds: string[]) {
    super(`Middleware cannot be deleted — ${String(routeIds.length)} route(s) still reference it.`);
    this.name = 'MiddlewareInUseError';
    this.routeIds = routeIds;
  }
}
