// Types for the services resource surface.

import type { ID } from './common';

export interface Service {
  readonly id: ID;
  readonly tenant_id: ID;
  name: string;
  upstream: string;
  env: string;
  health: 'healthy' | 'degraded' | 'unhealthy' | 'disabled';
  readonly created_at: string;
  description?: string;
  upstream_protocol: 'http' | 'https' | 'grpc';
  health_check?: { path: string; interval_seconds: number; timeout_seconds: number };
  tags: string[];
  last_reloaded_at?: string;
}
