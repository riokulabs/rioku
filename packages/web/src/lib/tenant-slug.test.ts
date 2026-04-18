import { describe, it, expect } from 'vitest';
import { isValidTenantSlug, tenantSlugError } from './tenant-slug';

describe('isValidTenantSlug', () => {
  it('accepts valid slug "acme"', () => {
    expect(isValidTenantSlug('acme')).toBe(true);
  });
  it('rejects reserved word "admin"', () => {
    expect(isValidTenantSlug('admin')).toBe(false);
  });
  it('rejects leading hyphen "-foo"', () => {
    expect(isValidTenantSlug('-foo')).toBe(false);
  });
  it('rejects uppercase "FOO"', () => {
    expect(isValidTenantSlug('FOO')).toBe(false);
  });
  it('rejects empty string', () => {
    expect(isValidTenantSlug('')).toBe(false);
  });
  it('rejects dot in slug "a.b"', () => {
    expect(isValidTenantSlug('a.b')).toBe(false);
  });
});

describe('tenantSlugError', () => {
  it('returns null for valid slug', () => {
    expect(tenantSlugError('acme')).toBeNull();
  });
  it('returns error for empty string', () => {
    expect(tenantSlugError('')).toBe('Slug required');
  });
  it('returns reserved error for "admin"', () => {
    expect(tenantSlugError('admin')).toBe('"admin" is reserved');
  });
  it('returns format error for "-foo"', () => {
    expect(tenantSlugError('-foo')).toMatch(/leading/i);
  });
  it('returns format error for "FOO"', () => {
    expect(tenantSlugError('FOO')).toMatch(/lowercase/i);
  });
  it('returns format error for "a.b"', () => {
    expect(tenantSlugError('a.b')).toMatch(/lowercase/i);
  });
});
