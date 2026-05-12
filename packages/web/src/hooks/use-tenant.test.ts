import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { detectTenantMode, useActiveTenantSlug, useTenant } from './use-tenant';

// Helper to mock window.location with specific hostname + pathname
function mockLocation(hostname: string, pathname: string) {
  Object.defineProperty(window, 'location', {
    value: { hostname, pathname },
    writable: true,
    configurable: true,
  });
}

describe('detectTenantMode', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to path-prefix when VITE_TENANT_MODE is not set', () => {
    vi.stubEnv('VITE_TENANT_MODE', '');
    expect(detectTenantMode()).toBe('path-prefix');
  });

  it('returns subdomain when VITE_TENANT_MODE=subdomain', () => {
    vi.stubEnv('VITE_TENANT_MODE', 'subdomain');
    expect(detectTenantMode()).toBe('subdomain');
  });

  it('returns single-tenant when VITE_TENANT_MODE=single-tenant', () => {
    vi.stubEnv('VITE_TENANT_MODE', 'single-tenant');
    expect(detectTenantMode()).toBe('single-tenant');
  });

  it('falls back to path-prefix for unknown values', () => {
    vi.stubEnv('VITE_TENANT_MODE', 'unknown-mode');
    expect(detectTenantMode()).toBe('path-prefix');
  });
});

describe('useActiveTenantSlug', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('path-prefix mode', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_TENANT_MODE', 'path-prefix');
    });

    it('extracts tenant slug from /t/:tenant path', () => {
      mockLocation('localhost', '/t/acme/dashboard');
      expect(useActiveTenantSlug()).toBe('acme');
    });

    it('returns null when not on a tenant path', () => {
      mockLocation('localhost', '/tenants');
      expect(useActiveTenantSlug()).toBeNull();
    });

    it('extracts tenant slug with nested path', () => {
      mockLocation('localhost', '/t/my-org/settings/users');
      expect(useActiveTenantSlug()).toBe('my-org');
    });
  });

  describe('subdomain mode', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_TENANT_MODE', 'subdomain');
    });

    it('extracts tenant slug from hostname', () => {
      mockLocation('acme.rioku.io', '/dashboard');
      expect(useActiveTenantSlug()).toBe('acme');
    });

    it('returns null when first subdomain is "admin"', () => {
      mockLocation('admin.rioku.io', '/');
      expect(useActiveTenantSlug()).toBeNull();
    });

    it('returns null for bare hostname (no dots)', () => {
      mockLocation('', '/');
      expect(useActiveTenantSlug()).toBeNull();
    });
  });

  describe('single-tenant mode', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_TENANT_MODE', 'single-tenant');
    });

    it('always returns null', () => {
      mockLocation('anything.host.com', '/t/anything');
      expect(useActiveTenantSlug()).toBeNull();
    });
  });
});

describe('useTenant', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns slug and mode together', () => {
    vi.stubEnv('VITE_TENANT_MODE', 'path-prefix');
    mockLocation('localhost', '/t/rioku-labs/dashboard');
    const result = useTenant();
    expect(result.slug).toBe('rioku-labs');
    expect(result.mode).toBe('path-prefix');
  });

  it('returns null slug in single-tenant mode', () => {
    vi.stubEnv('VITE_TENANT_MODE', 'single-tenant');
    mockLocation('localhost', '/dashboard');
    const result = useTenant();
    expect(result.slug).toBeNull();
    expect(result.mode).toBe('single-tenant');
  });
});
