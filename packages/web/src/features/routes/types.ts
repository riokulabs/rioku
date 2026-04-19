/**
 * Feature-local types for routes.
 */
export type { Route, ID } from '@/api/resources/types';

import type { Route } from '@/api/resources/types';

export interface RouteFilter {
  search: string;
  method: 'all' | Route['method'];
  enabled: 'all' | 'enabled' | 'disabled';
}

export type RouteInput = {
  service_id: string;
  name: string;
  path: string;
  method: Route['method'];
  match_kind: Route['match_kind'];
  strip_prefix?: boolean;
  rewrite_path?: string;
  headers_add?: Record<string, string>;
  headers_remove?: string[];
  policies?: string[];
  middleware_ids?: string[];
  enabled?: boolean;
};

export type RouteUpdateInput = Partial<RouteInput>;
