/**
 * Plugin-signers API unit tests (Stage 2 — real daemon endpoints).
 *
 * Uses MSW to intercept fetch calls to the daemon REST API.
 * Tests cover: createSigner, updateSigner, deleteSigner, verifySigner,
 * revokeSigner against the real tenant-scoped + global endpoints.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import { createSigner, updateSigner, deleteSigner, verifySigner, revokeSigner } from '../api';

const SHA256_FIXTURE = 'a'.repeat(64);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal DaemonSigner JSON response. */
function makeDaemonSigner(
  overrides: Partial<{
    id: string;
    tenantScope: string | null;
    name: string;
    fingerprint: string;
    status: 'verified' | 'revoked' | 'pending';
    notes: string;
  }> = {},
) {
  return {
    id: overrides.id ?? 'signer-abc',
    tenantScope: overrides.tenantScope ?? null,
    name: overrides.name ?? 'Test Signer',
    fingerprint: overrides.fingerprint ?? SHA256_FIXTURE,
    status: overrides.status ?? 'pending',
    notes: overrides.notes ?? '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('plugin-signers API (real daemon)', () => {
  beforeEach(() => {
    server.resetHandlers();
  });

  describe('createSigner', () => {
    it('creates a tenant-scoped signer and returns a PluginSigner', async () => {
      server.use(
        http.post('/api/v1/t/tenant-1/plugin-signers', () =>
          HttpResponse.json(
            makeDaemonSigner({ id: 'signer-new-1', tenantScope: 'tenant-1', status: 'pending' }),
            { status: 201 },
          ),
        ),
      );

      const signer = await createSigner({
        tenant_scope: 'tenant-1',
        name: 'Tenant Publisher',
        fingerprint: SHA256_FIXTURE,
        description: 'Unit-test publisher',
      });

      expect(signer.id).toBe('signer-new-1');
      expect(signer.status).toBe('pending');
      expect(signer.fingerprint).toBe(SHA256_FIXTURE);
      expect(signer.tenant_scope).toBe('tenant-1');
    });

    it('creates a global signer via /admin/plugin-signers', async () => {
      server.use(
        http.post('/api/v1/admin/plugin-signers', () =>
          HttpResponse.json(
            makeDaemonSigner({ id: 'signer-global-1', tenantScope: null, status: 'pending' }),
            { status: 201 },
          ),
        ),
      );

      const signer = await createSigner({
        tenant_scope: null,
        name: 'Global Publisher',
        fingerprint: SHA256_FIXTURE,
      });

      expect(signer.id).toBe('signer-global-1');
      expect(signer.tenant_scope).toBeNull();
    });
  });

  describe('updateSigner', () => {
    it('updates fingerprint and returns the updated signer', async () => {
      const newFingerprint = 'b'.repeat(64);
      server.use(
        http.put('/api/v1/t/tenant-1/plugin-signers/signer-abc', () =>
          HttpResponse.json(makeDaemonSigner({ id: 'signer-abc', fingerprint: newFingerprint })),
        ),
      );

      const updated = await updateSigner('signer-abc', { fingerprint: newFingerprint }, 'tenant-1');
      expect(updated.fingerprint).toBe(newFingerprint);
    });
  });

  describe('verifySigner', () => {
    it('POSTs to /verify and returns status=verified', async () => {
      server.use(
        http.post('/api/v1/t/tenant-1/plugin-signers/signer-abc/verify', () =>
          HttpResponse.json(makeDaemonSigner({ id: 'signer-abc', status: 'verified' })),
        ),
      );

      const verified = await verifySigner('signer-abc', 'tenant-1');
      expect(verified.status).toBe('verified');
    });

    it('POSTs to global /verify and returns status=verified', async () => {
      server.use(
        http.post('/api/v1/admin/plugin-signers/signer-global/verify', () =>
          HttpResponse.json(
            makeDaemonSigner({ id: 'signer-global', tenantScope: null, status: 'verified' }),
          ),
        ),
      );

      const verified = await verifySigner('signer-global', null);
      expect(verified.status).toBe('verified');
      expect(verified.tenant_scope).toBeNull();
    });
  });

  describe('revokeSigner', () => {
    it('POSTs to /revoke and returns status=revoked', async () => {
      server.use(
        http.post('/api/v1/t/tenant-1/plugin-signers/signer-abc/revoke', () =>
          HttpResponse.json(makeDaemonSigner({ id: 'signer-abc', status: 'revoked' })),
        ),
      );

      const revoked = await revokeSigner('signer-abc', 'tenant-1');
      expect(revoked.status).toBe('revoked');
    });
  });

  describe('deleteSigner', () => {
    it('DELETEs the signer and resolves void on 204', async () => {
      server.use(
        http.delete(
          '/api/v1/t/tenant-1/plugin-signers/signer-abc',
          () => new HttpResponse(null, { status: 204 }),
        ),
      );

      await expect(deleteSigner('signer-abc', 'tenant-1')).resolves.toBeUndefined();
    });

    it('throws when the daemon returns 404', async () => {
      server.use(
        http.delete('/api/v1/t/tenant-1/plugin-signers/nonexistent', () =>
          HttpResponse.json({ title: 'Signer not found', status: 404 }, { status: 404 }),
        ),
      );

      await expect(deleteSigner('nonexistent', 'tenant-1')).rejects.toThrow();
    });
  });
});
