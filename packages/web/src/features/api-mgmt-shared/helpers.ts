/**
 * Cross-resource helpers for the API-mgmt feature cluster
 * (services, routes, middlewares, policies, sites).
 *
 * Pure functions only — no Mantine imports here.
 */
import type { Middleware, Route, Service } from '@/api/resources/types';

/**
 * Format an upstream URL from parts. Defaults port behaviour: when omitted,
 * uses the protocol's default (http=80, https=443, grpc=50051).
 *
 * The grpc "protocol" renders with a `grpc://` scheme for display — it is not
 * the wire format but matches how Rioku's admin UI labels gRPC upstreams.
 */
export function formatUpstreamUrl(
  protocol: Service['upstream_protocol'],
  host: string,
  port?: number,
): string {
  if (host.length === 0) return '';
  if (port === undefined) {
    return `${protocol}://${host}`;
  }
  return `${protocol}://${host}:${String(port)}`;
}

/**
 * Build a concise match-preview string used in route list cells.
 *   buildMatchPreview('GET', 'prefix', '/api')  → "GET prefix:/api"
 *   buildMatchPreview('ANY', 'exact',  '/foo')  → "ANY exact:/foo"
 */
export function buildMatchPreview(
  method: Route['method'],
  matchKind: Route['match_kind'],
  path: string,
): string {
  return `${method} ${matchKind}:${path}`;
}

/**
 * Flags middlewares whose removal or edit carries authn/authz or payload
 * impact. Used to upgrade the delete-confirm copy ("This middleware enforces
 * authentication — removing it may expose unauthenticated traffic").
 */
export function isDestructiveMiddleware(kind: Middleware['kind']): boolean {
  return kind === 'auth' || kind === 'transform';
}
