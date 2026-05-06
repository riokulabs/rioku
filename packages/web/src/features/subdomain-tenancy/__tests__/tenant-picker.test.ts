/**
 * Tests for tenant picker URL routing logic (Plan 12 §T4).
 *
 * tenantDashboardUrl() computes the navigation target based on tenant.url_mode
 * and tenant.parent_domain. These tests verify path-mode tenants stay on the
 * same origin while subdomain-mode tenants get a cross-origin href.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Tenant } from '@/api/resources/common';
import { tenantDashboardUrl } from '@/routes/tenants';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTenant(overrides: Partial<Tenant>): Tenant {
  return {
    id: 'tenant_test',
    slug: 'acme',
    name: 'Acme Corp',
    accent: '#22c55e',
    plan: 'community',
    url_mode: 'path',
    default_theme: 'light',
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// window.location stub
// ---------------------------------------------------------------------------

let originalLocation: Location;

beforeEach(() => {
  originalLocation = window.location;
  // jsdom supports deleting and reassigning window.location.
  Object.defineProperty(window, 'location', {
    value: {
      protocol: 'http:',
      port: '5173',
      hostname: 'localhost',
      href: 'http://localhost:5173',
    },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  Object.defineProperty(window, 'location', {
    value: originalLocation,
    writable: true,
    configurable: true,
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('tenantDashboardUrl', () => {
  describe('path-mode tenant', () => {
    it('returns a same-origin path route', () => {
      const tenant = makeTenant({ url_mode: 'path', slug: 'acme' });
      const { href, isExternal } = tenantDashboardUrl(tenant);
      expect(isExternal).toBe(false);
      expect(href).toBe('/t/acme/dashboard');
    });

    it('path-mode with parent_domain set is still same-origin (url_mode wins)', () => {
      const tenant = makeTenant({ url_mode: 'path', slug: 'acme', parent_domain: 'localhost' });
      const { href, isExternal } = tenantDashboardUrl(tenant);
      expect(isExternal).toBe(false);
      expect(href).toBe('/t/acme/dashboard');
    });
  });

  describe('subdomain-mode tenant', () => {
    it('returns an external subdomain URL when parent_domain is set', () => {
      const tenant = makeTenant({ url_mode: 'subdomain', slug: 'acme', parent_domain: 'localhost' });
      const { href, isExternal } = tenantDashboardUrl(tenant);
      expect(isExternal).toBe(true);
      expect(href).toBe('http://acme.localhost:5173/t/acme/dashboard');
    });

    it('strips leading dot from parent_domain', () => {
      const tenant = makeTenant({ url_mode: 'subdomain', slug: 'acme', parent_domain: '.localhost' });
      const { href, isExternal } = tenantDashboardUrl(tenant);
      expect(isExternal).toBe(true);
      expect(href).toBe('http://acme.localhost:5173/t/acme/dashboard');
    });

    it('falls back to same-origin path when parent_domain is missing', () => {
      // Omitting parent_domain entirely (exactOptionalPropertyTypes forbids
      // explicit undefined for an optional property).
      const tenant = makeTenant({ url_mode: 'subdomain', slug: 'acme' });
      const { href, isExternal } = tenantDashboardUrl(tenant);
      expect(isExternal).toBe(false);
      expect(href).toBe('/t/acme/dashboard');
    });

    it('falls back to same-origin path when parent_domain is empty string', () => {
      const tenant = makeTenant({ url_mode: 'subdomain', slug: 'acme', parent_domain: '' });
      const { href, isExternal } = tenantDashboardUrl(tenant);
      expect(isExternal).toBe(false);
      expect(href).toBe('/t/acme/dashboard');
    });

    it('uses https when location.protocol is https:', () => {
      window.location.protocol = 'https:';
      const tenant = makeTenant({ url_mode: 'subdomain', slug: 'acme', parent_domain: 'example.com' });
      const { href } = tenantDashboardUrl(tenant);
      expect(href).toContain('https://acme.example.com');
    });

    it('omits port when location.port is empty', () => {
      Object.defineProperty(window, 'location', {
        value: { protocol: 'https:', port: '', hostname: 'example.com', href: 'https://example.com' },
        writable: true,
        configurable: true,
      });
      const tenant = makeTenant({ url_mode: 'subdomain', slug: 'acme', parent_domain: 'example.com' });
      const { href } = tenantDashboardUrl(tenant);
      expect(href).toBe('https://acme.example.com/t/acme/dashboard');
    });

    it('uses the tenant slug in both subdomain and path', () => {
      const tenant = makeTenant({ url_mode: 'subdomain', slug: 'my-org', parent_domain: 'localhost' });
      const { href } = tenantDashboardUrl(tenant);
      expect(href).toContain('my-org.localhost');
      expect(href).toContain('/t/my-org/dashboard');
    });
  });
});
