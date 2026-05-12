// Types for the routes resource surface.

import type { ID } from './common';

export interface Route {
  readonly id: ID;
  readonly service_id: ID;
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'ANY';
  policies: ID[];
  middleware_ids: ID[];
  name: string;
  match_kind: 'prefix' | 'exact' | 'regex';
  strip_prefix: boolean;
  rewrite_path?: string;
  headers_add: Record<string, string>;
  headers_remove: string[];
  enabled: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}
