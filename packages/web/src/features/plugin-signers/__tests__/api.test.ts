/**
 * Plugin-signers API unit tests (Plan 6).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { createSigner, updateSigner, deleteSigner, verifySigner, revokeSigner } from '../api';
import { SignerInUseError } from '../types';

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
});

const SHA256_FIXTURE = 'a'.repeat(64);

describe('plugin-signers API', () => {
  it('seed contains 6 signers with expected scopes + statuses', () => {
    const signers = Object.values(useMockStore.getState().pluginSigners);
    expect(signers.length).toBe(6);
    const globals = signers.filter((s) => s.tenant_scope === null);
    expect(globals.length).toBe(3);
    const statuses = new Set(signers.map((s) => s.status));
    expect(statuses.has('verified')).toBe(true);
    expect(statuses.has('revoked')).toBe(true);
    expect(statuses.has('pending')).toBe(true);
    // All fingerprints are 64 lowercase hex chars.
    for (const s of signers) {
      expect(s.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('createSigner adds a new signer + audit + host event', async () => {
    const signer = await createSigner({
      tenant_scope: null,
      name: 'Test Publisher',
      fingerprint: SHA256_FIXTURE,
      description: 'Unit-test publisher',
    });
    expect(signer.id).toMatch(/signer-new/);
    expect(signer.status).toBe('pending');
    expect(signer.fingerprint).toBe(SHA256_FIXTURE);

    const audit = useMockStore.getState().audit;
    const entry = audit[audit.length - 1];
    expect(entry?.action).toBe('plugin-signer.create');
    expect(entry?.resource_type).toBe('plugin-signer');
    expect(entry?.resource_id).toBe(signer.id);
  });

  it('updateSigner rotates fingerprint + writes diff audit', async () => {
    const signer = await createSigner({
      tenant_scope: null,
      name: 'Rotate Me',
      fingerprint: SHA256_FIXTURE,
    });
    const newFingerprint = 'b'.repeat(64);
    const updated = await updateSigner(signer.id, { fingerprint: newFingerprint });
    expect(updated.fingerprint).toBe(newFingerprint);

    const audit = useMockStore.getState().audit;
    const entry = audit[audit.length - 1];
    expect(entry?.action).toBe('plugin-signer.update');
    expect(entry?.diff).toBeDefined();
  });

  it('verifySigner flips status → verified and is idempotent', async () => {
    const signer = await createSigner({
      tenant_scope: null,
      name: 'Will Verify',
      fingerprint: SHA256_FIXTURE,
    });
    expect(signer.status).toBe('pending');

    const verified = await verifySigner(signer.id);
    expect(verified.status).toBe('verified');

    const beforeLen = useMockStore.getState().audit.length;
    // Second call is a no-op — no new audit entry.
    const again = await verifySigner(signer.id);
    expect(again.status).toBe('verified');
    const afterLen = useMockStore.getState().audit.length;
    expect(afterLen).toBe(beforeLen);
  });

  it('revokeSigner flips status → revoked and emits destructive audit', async () => {
    const signer = await createSigner({
      tenant_scope: null,
      name: 'Will Revoke',
      fingerprint: SHA256_FIXTURE,
      status: 'verified',
    });
    const revoked = await revokeSigner(signer.id);
    expect(revoked.status).toBe('revoked');

    const audit = useMockStore.getState().audit;
    const entry = audit[audit.length - 1];
    expect(entry?.action).toBe('plugin-signer.revoke');
    expect(entry?.tier).toBe('destructive');
  });

  it('deleteSigner refuses to delete a signer with referencing plugins', async () => {
    // Find the seeded Rioku Labs signer (has plugins attached).
    const rioku = Object.values(useMockStore.getState().pluginSigners).find(
      (s) => s.name === 'Rioku Labs',
    );
    if (!rioku) throw new Error('Rioku Labs signer missing from seed');
    await expect(deleteSigner(rioku.id)).rejects.toBeInstanceOf(SignerInUseError);

    // Still in the store.
    expect(useMockStore.getState().pluginSigners[rioku.id]).toBeDefined();
  });

  it('deleteSigner succeeds when no plugins reference the signer', async () => {
    const signer = await createSigner({
      tenant_scope: null,
      name: 'Orphan',
      fingerprint: SHA256_FIXTURE,
    });
    await deleteSigner(signer.id);
    expect(useMockStore.getState().pluginSigners[signer.id]).toBeUndefined();
    const audit = useMockStore.getState().audit;
    const entry = audit[audit.length - 1];
    expect(entry?.action).toBe('plugin-signer.delete');
    expect(entry?.tier).toBe('destructive');
  });
});
