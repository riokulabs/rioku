/**
 * Auth API tests — drive the real `customFetch` via MSW handlers that emulate
 * the daemon's `/api/v1/auth/*` endpoints.
 *
 * Plan 01 — stage 2 wiring.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import {
  login,
  logout,
  verifyTotp,
  verifyBackupCode,
  enrollTotp,
  confirmTotpEnrollment,
  bootstrap,
  fetchBootstrapStatus,
  requestPasswordReset,
  validateResetToken,
  applyPasswordReset,
  acceptInvite,
  getPendingAuthUserId,
  _resetPendingCredentialsForTests,
} from '../api';

const BASE = '/api/v1';

beforeEach(() => {
  _resetPendingCredentialsForTests();
});

describe('login()', () => {
  it('returns success on valid credentials', async () => {
    server.use(
      http.post(`${BASE}/auth/login`, () =>
        HttpResponse.json({
          user: {
            id: 'u1',
            username: 'alice',
            displayName: 'Alice',
            forcePasswordChange: false,
          },
          session: { id: 's1', expiresAt: '2026-12-31T00:00:00Z' },
        }),
      ),
    );

    const result = await login('alice', 'secret');
    expect(result).toEqual({ requires_totp: false, user_id: 'u1', tenant_id: '' });
    expect(getPendingAuthUserId()).toBeNull();
  });

  it('returns requires_totp on a TOTP challenge', async () => {
    server.use(
      http.post(`${BASE}/auth/login`, () =>
        HttpResponse.json({ requiresTotp: true, userId: 'u2' }),
      ),
    );

    const result = await login('bob@example.com', 'pw');
    expect(result).toMatchObject({ requires_totp: true, pending_user_id: 'u2' });
    expect(getPendingAuthUserId()).toBe('u2');
  });

  it('returns error envelope on 401', async () => {
    server.use(
      http.post(`${BASE}/auth/login`, () =>
        HttpResponse.json(
          { title: 'Authentication failed', detail: 'Invalid username or password' },
          { status: 401, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    const result = await login('alice', 'wrong');
    expect('error' in result).toBe(true);
  });

  it('returns error when password is empty', async () => {
    const result = await login('alice', '');
    expect(result).toMatchObject({ error: 'Password is required' });
  });
});

describe('verifyTotp()', () => {
  it('rejects non-6-digit codes', async () => {
    const result = await verifyTotp('abcdef');
    expect(result).toEqual({ ok: false, error: 'Code must be exactly 6 digits' });
  });

  it('refuses without a pending login', async () => {
    const result = await verifyTotp('123456');
    expect(result).toEqual({ ok: false, error: 'No pending authentication session' });
  });

  it('completes login by re-issuing /auth/login with totpCode', async () => {
    let firstCall = true;
    server.use(
      http.post(`${BASE}/auth/login`, async ({ request }) => {
        const body = (await request.json()) as { totpCode?: string };
        if (firstCall) {
          firstCall = false;
          return HttpResponse.json({ requiresTotp: true, userId: 'u9' });
        }
        expect(body.totpCode).toBe('654321');
        return HttpResponse.json({
          user: { id: 'u9', username: 'alice', forcePasswordChange: false },
          session: { id: 'sess-9', expiresAt: '2026-12-31T00:00:00Z' },
        });
      }),
    );

    await login('alice', 'pw');
    const result = await verifyTotp('654321');
    expect(result).toEqual({ ok: true, user_id: 'u9', tenant_id: '' });
    expect(getPendingAuthUserId()).toBeNull();
  });

  it('reports server error when daemon rejects code', async () => {
    let firstCall = true;
    server.use(
      http.post(`${BASE}/auth/login`, () => {
        if (firstCall) {
          firstCall = false;
          return HttpResponse.json({ requiresTotp: true, userId: 'u9' });
        }
        return HttpResponse.json(
          { title: 'Authentication failed', detail: 'Invalid TOTP code' },
          { status: 401, headers: { 'content-type': 'application/problem+json' } },
        );
      }),
    );

    await login('alice', 'pw');
    const result = await verifyTotp('000000');
    expect(result.ok).toBe(false);
  });
});

describe('verifyBackupCode()', () => {
  it('routes backup code through /auth/login totpCode field', async () => {
    let calls = 0;
    server.use(
      http.post(`${BASE}/auth/login`, async ({ request }) => {
        calls += 1;
        const body = (await request.json()) as { totpCode?: string };
        if (calls === 1) {
          return HttpResponse.json({ requiresTotp: true, userId: 'u10' });
        }
        expect(body.totpCode).toBe('backupcode');
        return HttpResponse.json({
          user: { id: 'u10', username: 'alice', forcePasswordChange: false },
          session: { id: 'sess-10', expiresAt: '2026-12-31T00:00:00Z' },
        });
      }),
    );

    await login('alice', 'pw');
    const result = await verifyBackupCode('  backupcode  ');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.user_id).toBe('u10');
  });
});

describe('logout()', () => {
  it('POSTs /auth/logout', async () => {
    let called = false;
    server.use(
      http.post(`${BASE}/auth/logout`, () => {
        called = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    await logout();
    expect(called).toBe(true);
    expect(getPendingAuthUserId()).toBeNull();
  });

  it('swallows 401', async () => {
    server.use(
      http.post(`${BASE}/auth/logout`, () =>
        HttpResponse.json({}, { status: 401 }),
      ),
    );

    await expect(logout()).resolves.toBeUndefined();
  });
});

describe('enrollTotp() + confirmTotpEnrollment()', () => {
  it('setup → confirm returns backup codes', async () => {
    server.use(
      http.post(`${BASE}/auth/totp/setup`, () =>
        HttpResponse.json({ secret: 'JBSWY3DPEHPK3PXP', qrUri: 'otpauth://totp/x' }),
      ),
      http.post(`${BASE}/auth/totp/verify`, () =>
        HttpResponse.json({ backupCodes: ['CODE1', 'CODE2', 'CODE3'] }),
      ),
    );

    const setup = await enrollTotp();
    expect(setup.secret).toBe('JBSWY3DPEHPK3PXP');
    expect(setup.qr_url).toBe('otpauth://totp/x');

    const result = await confirmTotpEnrollment('u1', '123456');
    expect(result.ok).toBe(true);
    expect(result.backup_codes).toEqual(['CODE1', 'CODE2', 'CODE3']);
  });

  it('confirmTotpEnrollment rejects malformed code without hitting network', async () => {
    const result = await confirmTotpEnrollment('u1', 'abc');
    expect(result).toEqual({ ok: false, error: 'Code must be exactly 6 digits' });
  });
});

describe('bootstrap status / bootstrap()', () => {
  it('fetches status', async () => {
    server.use(
      http.get(`${BASE}/auth/bootstrap-status`, () =>
        HttpResponse.json({ required: true }),
      ),
    );
    const s = await fetchBootstrapStatus();
    expect(s.required).toBe(true);
  });

  it('bootstrap returns ok with ids', async () => {
    server.use(
      http.post(`${BASE}/auth/bootstrap`, async ({ request }) => {
        const body = (await request.json()) as Record<string, string>;
        expect(body.email).toBe('root@example.com');
        expect(body.tenantSlug).toBe('main');
        expect(body.tenantName).toBe('Main');
        return HttpResponse.json(
          { tenantId: 't1', userId: 'u1' },
          { status: 201 },
        );
      }),
    );

    const result = await bootstrap({
      email: 'root@example.com',
      name: 'Root',
      password: 'TestRoot1234!',
      tenant_name: 'Main',
      tenant_slug: 'main',
    });
    expect(result).toEqual({ ok: true, user_id: 'u1', tenant_id: 't1' });
  });

  it('bootstrap surfaces 409 conflict as an error', async () => {
    server.use(
      http.post(`${BASE}/auth/bootstrap`, () =>
        HttpResponse.json(
          { title: 'Bootstrap already completed' },
          { status: 409, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    const result = await bootstrap({
      email: 'a@b.c',
      name: 'A',
      password: 'TestRoot1234!',
      tenant_name: 'M',
      tenant_slug: 'm',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe('password reset', () => {
  it('request always succeeds (anti-enumeration)', async () => {
    server.use(
      http.post(`${BASE}/auth/password-reset/request`, () =>
        new HttpResponse(null, { status: 202 }),
      ),
    );

    const result = await requestPasswordReset('nobody@example.com');
    expect('error' in result).toBe(false);
  });

  it('validate returns ok when token usable', async () => {
    server.use(
      http.get(`${BASE}/auth/password-reset/validate`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('token')).toBe('abc');
        return HttpResponse.json({ valid: true });
      }),
    );

    const result = await validateResetToken('abc');
    expect(result.ok).toBe(true);
  });

  it('validate returns error on 410', async () => {
    server.use(
      http.get(`${BASE}/auth/password-reset/validate`, () =>
        HttpResponse.json(
          { title: 'Token expired' },
          { status: 410, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    const result = await validateResetToken('abc');
    expect(result.ok).toBe(false);
  });

  it('apply succeeds on 200', async () => {
    server.use(
      http.post(`${BASE}/auth/password-reset/apply`, async ({ request }) => {
        const body = (await request.json()) as { token: string; password: string };
        expect(body.token).toBe('xyz');
        expect(body.password).toBe('NewPass1!');
        return HttpResponse.json({ ok: true });
      }),
    );
    const r = await applyPasswordReset('xyz', 'NewPass1!');
    expect(r.ok).toBe(true);
  });
});

describe('acceptInvite()', () => {
  it('POSTs token + name + password', async () => {
    server.use(
      http.post(`${BASE}/auth/invite/accept`, async ({ request }) => {
        const body = (await request.json()) as Record<string, string>;
        expect(body.token).toBe('inv-token');
        expect(body.name).toBe('New User');
        expect(body.password).toBe('NewPass1!');
        return HttpResponse.json(
          { userId: 'u-new', sessionId: 's-new', status: 'created' },
          { status: 201 },
        );
      }),
    );

    const result = await acceptInvite('inv-token', {
      name: 'New User',
      password: 'NewPass1!',
    });
    expect(result.ok).toBe(true);
    expect(result.user_id).toBe('u-new');
  });

  it('surfaces 410 as error', async () => {
    server.use(
      http.post(`${BASE}/auth/invite/accept`, () =>
        HttpResponse.json(
          { title: 'Invite invalid' },
          { status: 410, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    const result = await acceptInvite('bad', { name: 'X', password: 'PassWord1!' });
    expect(result.ok).toBe(false);
  });
});
