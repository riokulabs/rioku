/**
 * Tests for the routes proto ↔ admin resource adapter.
 */
import { describe, it, expect } from 'vitest';
import type { V1Route } from '@/api/generated/schemas';
import { V1PathMatcherType } from '@/api/generated/schemas';
import {
  fromProtoRoute,
  toProtoRouteBody,
  toProtoRoutePatch,
  LBL_MATCH_KIND,
  LBL_STRIP_PREFIX,
  LBL_REWRITE_PATH,
  LBL_HEADERS_ADD,
  LBL_HEADERS_REMOVE,
  LBL_MIDDLEWARE_IDS,
} from '../adapter';
import type { RouteInput } from '../types';

// ─── fromProtoRoute ───────────────────────────────────────────────────────────

describe('fromProtoRoute', () => {
  const baseProto: V1Route = {
    id: 'rt-1',
    name: 'get-users',
    serviceId: 'svc-1',
    enabled: true,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
    policyIds: ['pol-1'],
    matchers: [
      {
        methods: ['GET'],
        paths: [{ type: V1PathMatcherType.TYPE_PREFIX, value: '/api/users' }],
      },
    ],
  };

  it('maps id, name, serviceId, enabled from proto', () => {
    const route = fromProtoRoute(baseProto, 'tenant-1');
    expect(route.id).toBe('rt-1');
    expect(route.name).toBe('get-users');
    expect(route.service_id).toBe('svc-1');
    expect(route.enabled).toBe(true);
  });

  it('extracts method from first matcher', () => {
    const route = fromProtoRoute(baseProto, 'tenant-1');
    expect(route.method).toBe('GET');
  });

  it('extracts path from first path matcher', () => {
    const route = fromProtoRoute(baseProto, 'tenant-1');
    expect(route.path).toBe('/api/users');
  });

  it('maps match_kind from path matcher type', () => {
    const prefix = fromProtoRoute(baseProto, 'tenant-1');
    expect(prefix.match_kind).toBe('prefix');

    const exact = fromProtoRoute(
      { ...baseProto, matchers: [{ paths: [{ type: V1PathMatcherType.TYPE_EXACT, value: '/api' }] }] },
      't',
    );
    expect(exact.match_kind).toBe('exact');

    const regex = fromProtoRoute(
      { ...baseProto, matchers: [{ paths: [{ type: V1PathMatcherType.TYPE_REGEXP, value: '^/api' }] }] },
      't',
    );
    expect(regex.match_kind).toBe('regex');
  });

  it('maps policyIds to policies array', () => {
    const route = fromProtoRoute(baseProto, 'tenant-1');
    expect(route.policies).toEqual(['pol-1']);
  });

  it('defaults to empty policies when policyIds absent', () => {
    const route = fromProtoRoute({ ...baseProto, policyIds: undefined }, 'tenant-1');
    expect(route.policies).toEqual([]);
  });

  it('reads middleware_ids from labels', () => {
    const proto: V1Route = {
      ...baseProto,
      labels: { labels: { [LBL_MIDDLEWARE_IDS]: 'mw-1,mw-2' } },
    };
    const route = fromProtoRoute(proto, 'tenant-1');
    expect(route.middleware_ids).toEqual(['mw-1', 'mw-2']);
  });

  it('defaults to empty middleware_ids when label absent', () => {
    const route = fromProtoRoute(baseProto, 'tenant-1');
    expect(route.middleware_ids).toEqual([]);
  });

  it('reads strip_prefix from label', () => {
    const proto: V1Route = {
      ...baseProto,
      labels: { labels: { [LBL_STRIP_PREFIX]: 'true' } },
    };
    expect(fromProtoRoute(proto, 'tenant-1').strip_prefix).toBe(true);
  });

  it('reads rewrite_path from label', () => {
    const proto: V1Route = {
      ...baseProto,
      labels: { labels: { [LBL_REWRITE_PATH]: '/new-path' } },
    };
    expect(fromProtoRoute(proto, 'tenant-1').rewrite_path).toBe('/new-path');
  });

  it('reads headers_add from JSON label', () => {
    const proto: V1Route = {
      ...baseProto,
      labels: { labels: { [LBL_HEADERS_ADD]: '{"X-Tenant":"acme"}' } },
    };
    expect(fromProtoRoute(proto, 'tenant-1').headers_add).toEqual({ 'X-Tenant': 'acme' });
  });

  it('reads headers_remove from comma-separated label', () => {
    const proto: V1Route = {
      ...baseProto,
      labels: { labels: { [LBL_HEADERS_REMOVE]: 'X-Debug,X-Internal' } },
    };
    expect(fromProtoRoute(proto, 'tenant-1').headers_remove).toEqual(['X-Debug', 'X-Internal']);
  });

  it('defaults to ANY method when no methods in matcher', () => {
    const route = fromProtoRoute({ ...baseProto, matchers: [{}] }, 'tenant-1');
    expect(route.method).toBe('ANY');
  });
});

// ─── toProtoRouteBody ─────────────────────────────────────────────────────────

describe('toProtoRouteBody', () => {
  const baseInput: RouteInput = {
    service_id: 'svc-1',
    name: 'create-user',
    path: '/api/users',
    method: 'POST',
    match_kind: 'prefix',
  };

  it('sets name, serviceId, enabled', () => {
    const body = toProtoRouteBody(baseInput);
    expect(body.name).toBe('create-user');
    expect(body.serviceId).toBe('svc-1');
    expect(body.enabled).toBe(true);
  });

  it('sets method in matcher (not ANY)', () => {
    const body = toProtoRouteBody(baseInput);
    expect(body.matchers?.[0]?.methods).toEqual(['POST']);
  });

  it('sets empty methods array for ANY method', () => {
    const body = toProtoRouteBody({ ...baseInput, method: 'ANY' });
    expect(body.matchers?.[0]?.methods).toEqual([]);
  });

  it('maps prefix match_kind to TYPE_PREFIX', () => {
    const body = toProtoRouteBody(baseInput);
    expect(body.matchers?.[0]?.paths?.[0]?.type).toBe(V1PathMatcherType.TYPE_PREFIX);
    expect(body.matchers?.[0]?.paths?.[0]?.value).toBe('/api/users');
  });

  it('maps exact match_kind to TYPE_EXACT', () => {
    const body = toProtoRouteBody({ ...baseInput, match_kind: 'exact' });
    expect(body.matchers?.[0]?.paths?.[0]?.type).toBe(V1PathMatcherType.TYPE_EXACT);
  });

  it('maps regex match_kind to TYPE_REGEXP', () => {
    const body = toProtoRouteBody({ ...baseInput, match_kind: 'regex' });
    expect(body.matchers?.[0]?.paths?.[0]?.type).toBe(V1PathMatcherType.TYPE_REGEXP);
  });

  it('stores middleware_ids in label when provided', () => {
    const body = toProtoRouteBody({ ...baseInput, middleware_ids: ['mw-1', 'mw-2'] });
    expect(body.labels?.labels?.[LBL_MIDDLEWARE_IDS]).toBe('mw-1,mw-2');
  });

  it('stores headers_add as JSON in label', () => {
    const body = toProtoRouteBody({ ...baseInput, headers_add: { 'X-Tenant': 'acme' } });
    expect(body.labels?.labels?.[LBL_HEADERS_ADD]).toBe('{"X-Tenant":"acme"}');
  });

  it('stores headers_remove as CSV in label', () => {
    const body = toProtoRouteBody({ ...baseInput, headers_remove: ['X-Debug', 'X-Internal'] });
    expect(body.labels?.labels?.[LBL_HEADERS_REMOVE]).toBe('X-Debug,X-Internal');
  });

  it('sets policyIds from policies input', () => {
    const body = toProtoRouteBody({ ...baseInput, policies: ['pol-1', 'pol-2'] });
    expect(body.policyIds).toEqual(['pol-1', 'pol-2']);
  });
});

// ─── toProtoRoutePatch ────────────────────────────────────────────────────────

describe('toProtoRoutePatch', () => {
  it('only patches name when only name provided', () => {
    const patch = toProtoRoutePatch({ name: 'renamed' });
    expect(patch.name).toBe('renamed');
    expect(patch.matchers).toBeUndefined();
    expect(patch.labels).toBeUndefined();
  });

  it('patches enabled field', () => {
    const patch = toProtoRoutePatch({ enabled: false });
    expect(patch.enabled).toBe(false);
  });

  it('patches policyIds from policies', () => {
    const patch = toProtoRoutePatch({ policies: ['pol-x'] });
    expect(patch.policyIds).toEqual(['pol-x']);
  });

  it('rebuilds matchers when path changes', () => {
    const patch = toProtoRoutePatch({ path: '/new-path', method: 'DELETE', match_kind: 'exact' });
    expect(patch.matchers?.[0]?.paths?.[0]?.value).toBe('/new-path');
    expect(patch.matchers?.[0]?.methods).toEqual(['DELETE']);
    expect(patch.matchers?.[0]?.paths?.[0]?.type).toBe(V1PathMatcherType.TYPE_EXACT);
  });

  it('stores middleware_ids update in label', () => {
    const patch = toProtoRoutePatch({ middleware_ids: ['mw-3'] });
    expect(patch.labels?.labels?.[LBL_MIDDLEWARE_IDS]).toBe('mw-3');
  });
});
