/**
 * Tests for the services proto ↔ admin resource adapter.
 *
 * Validates that fromProtoService and toProtoServiceBody/Patch correctly
 * bridge the V1Service proto shape to the admin Service resource type.
 */
import { describe, it, expect } from 'vitest';
import type { V1Service } from '@/api/generated/schemas';
import {
  fromProtoService,
  toProtoServiceBody,
  toProtoServicePatch,
  LBL_ENV,
  LBL_TAGS,
  LBL_PROTOCOL,
  LBL_DESCRIPTION,
  LBL_DISABLED,
} from '../adapter';
import type { ServiceInput } from '../types';

// ─── fromProtoService ─────────────────────────────────────────────────────────

describe('fromProtoService', () => {
  it('maps id, name, createdAt from proto fields', () => {
    const proto: V1Service = {
      id: 'svc-1',
      name: 'my-api',
      createdAt: '2024-01-01T00:00:00Z',
      upstreams: [{ address: 'http://backend:8080', healthy: true }],
    };
    const svc = fromProtoService(proto, 'tenant-1');
    expect(svc.id).toBe('svc-1');
    expect(svc.name).toBe('my-api');
    expect(svc.created_at).toBe('2024-01-01T00:00:00Z');
    expect(svc.tenant_id).toBe('tenant-1');
  });

  it('extracts upstream address from first upstream', () => {
    const proto: V1Service = {
      id: 'svc-2',
      name: 'api',
      upstreams: [{ address: 'http://backend:9000' }, { address: 'http://backend:9001' }],
    };
    const svc = fromProtoService(proto, 'tenant-1');
    expect(svc.upstream).toBe('http://backend:9000');
  });

  it('reads env, tags, protocol, description from labels', () => {
    const proto: V1Service = {
      id: 'svc-3',
      name: 'api',
      upstreams: [{ address: 'http://backend:8080', healthy: true }],
      labels: {
        labels: {
          [LBL_ENV]: 'production',
          [LBL_TAGS]: 'critical,internal',
          [LBL_PROTOCOL]: 'https',
          [LBL_DESCRIPTION]: 'Main API service',
        },
      },
    };
    const svc = fromProtoService(proto, 'tenant-1');
    expect(svc.env).toBe('production');
    expect(svc.tags).toEqual(['critical', 'internal']);
    expect(svc.upstream_protocol).toBe('https');
    expect(svc.description).toBe('Main API service');
  });

  it('returns empty tags array when no tags label', () => {
    const proto: V1Service = { id: 'svc-4', name: 'api', upstreams: [] };
    const svc = fromProtoService(proto, 'tenant-1');
    expect(svc.tags).toEqual([]);
  });

  describe('health derivation', () => {
    it('returns "disabled" when disabled label is "true"', () => {
      const proto: V1Service = {
        id: 'svc-5',
        name: 'api',
        upstreams: [{ address: 'http://b:8080', healthy: true }],
        labels: { labels: { [LBL_DISABLED]: 'true' } },
      };
      expect(fromProtoService(proto, 'tenant-1').health).toBe('disabled');
    });

    it('returns "healthy" when all upstreams are healthy', () => {
      const proto: V1Service = {
        id: 'svc-6',
        name: 'api',
        upstreams: [
          { address: 'http://b1:8080', healthy: true },
          { address: 'http://b2:8080', healthy: true },
        ],
      };
      expect(fromProtoService(proto, 'tenant-1').health).toBe('healthy');
    });

    it('returns "degraded" when some upstreams are unhealthy', () => {
      const proto: V1Service = {
        id: 'svc-7',
        name: 'api',
        upstreams: [
          { address: 'http://b1:8080', healthy: true },
          { address: 'http://b2:8080', healthy: false },
        ],
      };
      expect(fromProtoService(proto, 'tenant-1').health).toBe('degraded');
    });

    it('returns "unhealthy" when all upstreams are unhealthy', () => {
      const proto: V1Service = {
        id: 'svc-8',
        name: 'api',
        upstreams: [{ address: 'http://b:8080', healthy: false }],
      };
      expect(fromProtoService(proto, 'tenant-1').health).toBe('unhealthy');
    });

    it('returns "unhealthy" when no upstreams', () => {
      const proto: V1Service = { id: 'svc-9', name: 'api', upstreams: [] };
      expect(fromProtoService(proto, 'tenant-1').health).toBe('unhealthy');
    });
  });

  it('maps healthCheck fields from proto', () => {
    const proto: V1Service = {
      id: 'svc-10',
      name: 'api',
      upstreams: [{ address: 'http://b:8080', healthy: true }],
      healthCheck: { path: '/health', intervalSeconds: 15, timeoutSeconds: 3 },
    };
    const svc = fromProtoService(proto, 'tenant-1');
    expect(svc.health_check).toEqual({
      path: '/health',
      interval_seconds: 15,
      timeout_seconds: 3,
    });
  });

  it('omits health_check when proto has no healthCheck', () => {
    const proto: V1Service = { id: 'svc-11', name: 'api', upstreams: [] };
    const svc = fromProtoService(proto, 'tenant-1');
    expect(svc.health_check).toBeUndefined();
  });
});

// ─── toProtoServiceBody ───────────────────────────────────────────────────────

describe('toProtoServiceBody', () => {
  const baseInput: ServiceInput = {
    name: 'my-api',
    upstream: 'http://backend:8080',
    upstream_protocol: 'http',
    env: 'staging',
    tags: ['tag-a', 'tag-b'],
  };

  it('sets name and upstream address', () => {
    const body = toProtoServiceBody(baseInput);
    expect(body.name).toBe('my-api');
    expect(body.upstreams).toHaveLength(1);
    expect(body.upstreams![0].address).toBe('http://backend:8080');
  });

  it('encodes env, tags, protocol in labels', () => {
    const body = toProtoServiceBody(baseInput);
    const labels = body.labels?.labels ?? {};
    expect(labels[LBL_ENV]).toBe('staging');
    expect(labels[LBL_TAGS]).toBe('tag-a,tag-b');
    expect(labels[LBL_PROTOCOL]).toBe('http');
  });

  it('encodes description in labels when provided', () => {
    const body = toProtoServiceBody({ ...baseInput, description: 'My service' });
    expect(body.labels?.labels?.[LBL_DESCRIPTION]).toBe('My service');
  });

  it('maps healthCheck from health_check input', () => {
    const body = toProtoServiceBody({
      ...baseInput,
      health_check: { path: '/health', interval_seconds: 30, timeout_seconds: 5 },
    });
    expect(body.healthCheck).toEqual({
      path: '/health',
      intervalSeconds: 30,
      timeoutSeconds: 5,
    });
  });

  it('omits healthCheck when health_check not provided', () => {
    const body = toProtoServiceBody(baseInput);
    expect(body.healthCheck).toBeUndefined();
  });
});

// ─── toProtoServicePatch ──────────────────────────────────────────────────────

describe('toProtoServicePatch', () => {
  it('only patches fields that are provided', () => {
    const patch = toProtoServicePatch({ name: 'renamed' });
    expect(patch.name).toBe('renamed');
    expect(patch.upstreams).toBeUndefined();
    expect(patch.labels).toBeUndefined();
  });

  it('patches upstream when upstream changes', () => {
    const patch = toProtoServicePatch({ upstream: 'http://new-backend:9090' });
    expect(patch.upstreams).toHaveLength(1);
    expect(patch.upstreams![0].address).toBe('http://new-backend:9090');
  });

  it('sets disabled label when health is set to "disabled"', () => {
    const patch = toProtoServicePatch({ health: 'disabled' });
    expect(patch.labels?.labels?.[LBL_DISABLED]).toBe('true');
  });

  it('clears disabled label when health is set to "healthy"', () => {
    const patch = toProtoServicePatch({ health: 'healthy' });
    expect(patch.labels?.labels?.[LBL_DISABLED]).toBe('false');
  });

  it('encodes env and tags when provided', () => {
    const patch = toProtoServicePatch({ env: 'production', tags: ['a', 'b'] });
    expect(patch.labels?.labels?.[LBL_ENV]).toBe('production');
    expect(patch.labels?.labels?.[LBL_TAGS]).toBe('a,b');
  });
});
