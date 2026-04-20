/**
 * Zod schema tests for plugin-signer validators (Plan 6).
 */
import { describe, it, expect } from 'vitest';
import { createSignerSchema, updateSignerSchema } from '../schemas';

const VALID_FINGERPRINT = 'a'.repeat(64);

describe('createSignerSchema', () => {
  it('accepts a well-formed signer', () => {
    const result = createSignerSchema.safeParse({
      tenant_scope: null,
      name: 'Example',
      fingerprint: VALID_FINGERPRINT,
    });
    expect(result.success).toBe(true);
  });

  it('rejects fingerprints that are not 64 hex chars', () => {
    const result = createSignerSchema.safeParse({
      tenant_scope: null,
      name: 'Example',
      fingerprint: 'abc',
    });
    expect(result.success).toBe(false);
  });

  it('rejects uppercase fingerprints (we enforce lowercase hex)', () => {
    const result = createSignerSchema.safeParse({
      tenant_scope: null,
      name: 'Example',
      fingerprint: 'A'.repeat(64),
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty names', () => {
    const result = createSignerSchema.safeParse({
      tenant_scope: null,
      name: '',
      fingerprint: VALID_FINGERPRINT,
    });
    expect(result.success).toBe(false);
  });

  it('accepts a tenant-scoped signer', () => {
    const result = createSignerSchema.safeParse({
      tenant_scope: 'tenant-1',
      name: 'Example',
      fingerprint: VALID_FINGERPRINT,
    });
    expect(result.success).toBe(true);
  });
});

describe('updateSignerSchema', () => {
  it('accepts a partial patch', () => {
    const result = updateSignerSchema.safeParse({ name: 'Renamed' });
    expect(result.success).toBe(true);
  });

  it('accepts an empty patch', () => {
    const result = updateSignerSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('still enforces fingerprint format on rotation', () => {
    const result = updateSignerSchema.safeParse({ fingerprint: 'not-hex' });
    expect(result.success).toBe(false);
  });
});
