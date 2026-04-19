/**
 * Feature-local types for services.
 */
export type { Service, Route, ID } from '@/api/resources/types';

import type { Service } from '@/api/resources/types';

type HealthStatus = Service['health'];

/** Filter state for the services list. */
export interface ServiceFilter {
  search: string;
  health: 'all' | HealthStatus;
  /** Environment filter. Use `'all'` for unfiltered; any other value matches a specific environment. */
  env: string;
  tag: string | null;
}

export interface ServiceInput {
  name: string;
  description?: string;
  upstream: string;
  upstream_protocol: Service['upstream_protocol'];
  env: string;
  tags?: string[];
  health_check?: {
    path: string;
    interval_seconds: number;
    timeout_seconds: number;
  };
}

export interface ServiceUpdateInput extends Partial<ServiceInput> {
  health?: Service['health'];
}

export class ServiceInUseError extends Error {
  readonly code = 'SERVICE_IN_USE';
  readonly routeIds: string[];
  constructor(routeIds: string[]) {
    super(
      `Service cannot be deleted — ${String(routeIds.length)} route(s) still reference it.`,
    );
    this.name = 'ServiceInUseError';
    this.routeIds = routeIds;
  }
}
