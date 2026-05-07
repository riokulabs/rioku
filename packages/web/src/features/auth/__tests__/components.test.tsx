/**
 * Auth component tests — render forms with MSW handlers and assert that they
 * (a) submit the expected payload to the daemon, (b) navigate on success,
 * and (c) render daemon-supplied error envelopes.
 *
 * Plan 01 — stage 2 wiring.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import { LoginForm } from '../components/login-form';
import { BootstrapForm } from '../components/bootstrap-form';
import { ForgotPasswordForm } from '../components/forgot-password-form';
import { ResetPasswordForm } from '../components/reset-password-form';
import { InviteAcceptanceForm } from '../components/invite-acceptance-form';
import { TotpRecoveryForm } from '../components/totp-recovery';
import { _resetPendingCredentialsForTests, login } from '../api';

const BASE = '/api/v1';

const mockNavigate = vi.fn().mockResolvedValue(undefined);

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  Anchor: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/api/auth-failure', () => ({
  consumeReturnUrl: vi.fn().mockReturnValue(null),
  setAuthFailureRouter: vi.fn(),
  handleAuthFailure: vi.fn(),
}));

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MantineProvider>{ui}</MantineProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockNavigate.mockClear();
  _resetPendingCredentialsForTests();
});

describe('<LoginForm>', () => {
  it('renders email + password inputs and a submit button', () => {
    wrap(<LoginForm />);
    expect(screen.getByTestId('email-input')).toBeInTheDocument();
    expect(screen.getByTestId('password-input')).toBeInTheDocument();
    expect(screen.getByTestId('login-submit')).toBeInTheDocument();
  });

  it('does not navigate when email is invalid (client-side validation)', async () => {
    wrap(<LoginForm />);
    fireEvent.change(screen.getByTestId('email-input'), {
      target: { value: 'notanemail' },
    });
    fireEvent.change(screen.getByTestId('password-input'), {
      target: { value: 'pw' },
    });
    fireEvent.click(screen.getByTestId('login-submit'));
    await new Promise((r) => setTimeout(r, 50));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('submits valid credentials and navigates on success', async () => {
    server.use(
      http.post(`${BASE}/auth/login`, async ({ request }) => {
        const body = (await request.json()) as { username: string; password: string };
        expect(body.username).toBe('alice@example.com');
        expect(body.password).toBe('hunter2');
        return HttpResponse.json({
          user: { id: 'u1', username: 'alice', forcePasswordChange: false },
          session: { id: 's1', expiresAt: '2026-12-31T00:00:00Z' },
        });
      }),
    );

    wrap(<LoginForm />);
    fireEvent.change(screen.getByTestId('email-input'), {
      target: { value: 'alice@example.com' },
    });
    fireEvent.change(screen.getByTestId('password-input'), {
      target: { value: 'hunter2' },
    });
    fireEvent.click(screen.getByTestId('login-submit'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({ to: '/' });
    });
  });

  it('navigates to /totp on TOTP challenge', async () => {
    server.use(
      http.post(`${BASE}/auth/login`, () =>
        HttpResponse.json({ requiresTotp: true, userId: 'u9' }),
      ),
    );

    wrap(<LoginForm />);
    fireEvent.change(screen.getByTestId('email-input'), {
      target: { value: 'alice@example.com' },
    });
    fireEvent.change(screen.getByTestId('password-input'), {
      target: { value: 'pw' },
    });
    fireEvent.click(screen.getByTestId('login-submit'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        expect.objectContaining({ to: '/totp' }),
      );
    });
  });

  it('renders the daemon error envelope on 401', async () => {
    server.use(
      http.post(`${BASE}/auth/login`, () =>
        HttpResponse.json(
          { title: 'Authentication failed' },
          { status: 401, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    wrap(<LoginForm />);
    fireEvent.change(screen.getByTestId('email-input'), {
      target: { value: 'alice@example.com' },
    });
    fireEvent.change(screen.getByTestId('password-input'), {
      target: { value: 'wrong' },
    });
    fireEvent.click(screen.getByTestId('login-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('login-error')).toBeInTheDocument();
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe('<BootstrapForm>', () => {
  it('submits the daemon-shaped payload and navigates to /login', async () => {
    server.use(
      http.post(`${BASE}/auth/bootstrap`, async ({ request }) => {
        const body = (await request.json()) as Record<string, string>;
        expect(body.email).toBe('root@example.com');
        expect(body.tenantSlug).toBe('main');
        expect(body.tenantName).toBe('Main Org');
        return HttpResponse.json({ tenantId: 't1', userId: 'u1' }, { status: 201 });
      }),
    );

    wrap(<BootstrapForm />);
    fireEvent.change(screen.getByTestId('bootstrap-tenant-name'), {
      target: { value: 'Main Org' },
    });
    fireEvent.change(screen.getByTestId('bootstrap-tenant-slug'), {
      target: { value: 'main' },
    });
    fireEvent.change(screen.getByTestId('bootstrap-name'), {
      target: { value: 'Root User' },
    });
    fireEvent.change(screen.getByTestId('bootstrap-email'), {
      target: { value: 'root@example.com' },
    });
    fireEvent.change(screen.getByTestId('bootstrap-password'), {
      target: { value: 'TestRoot1234!' },
    });
    fireEvent.change(screen.getByTestId('bootstrap-confirm'), {
      target: { value: 'TestRoot1234!' },
    });
    fireEvent.click(screen.getByTestId('bootstrap-submit'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({ to: '/login' });
    });
    expect(screen.getByTestId('bootstrap-success')).toBeInTheDocument();
  });

  it('shows a daemon-supplied error on 409', async () => {
    server.use(
      http.post(`${BASE}/auth/bootstrap`, () =>
        HttpResponse.json(
          { title: 'Bootstrap already completed' },
          { status: 409, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    wrap(<BootstrapForm />);
    fireEvent.change(screen.getByTestId('bootstrap-tenant-name'), {
      target: { value: 'Main' },
    });
    fireEvent.change(screen.getByTestId('bootstrap-tenant-slug'), {
      target: { value: 'main' },
    });
    fireEvent.change(screen.getByTestId('bootstrap-name'), {
      target: { value: 'Root' },
    });
    fireEvent.change(screen.getByTestId('bootstrap-email'), {
      target: { value: 'root@example.com' },
    });
    fireEvent.change(screen.getByTestId('bootstrap-password'), {
      target: { value: 'TestRoot1234!' },
    });
    fireEvent.change(screen.getByTestId('bootstrap-confirm'), {
      target: { value: 'TestRoot1234!' },
    });
    fireEvent.click(screen.getByTestId('bootstrap-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('bootstrap-error')).toBeInTheDocument();
    });
  });
});

describe('<ForgotPasswordForm>', () => {
  it('renders generic success after a successful request', async () => {
    server.use(
      http.post(`${BASE}/auth/password-reset/request`, async ({ request }) => {
        const body = (await request.json()) as { email: string };
        expect(body.email).toBe('alice@example.com');
        return new HttpResponse(null, { status: 202 });
      }),
    );

    wrap(<ForgotPasswordForm />);
    fireEvent.change(screen.getByTestId('forgot-email-input'), {
      target: { value: 'alice@example.com' },
    });
    fireEvent.click(screen.getByTestId('forgot-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('reset-success-message')).toBeInTheDocument();
    });
  });
});

describe('<ResetPasswordForm>', () => {
  it('validates token then applies a new password', async () => {
    server.use(
      http.get(`${BASE}/auth/password-reset/validate`, () =>
        HttpResponse.json({ valid: true }),
      ),
      http.post(`${BASE}/auth/password-reset/apply`, async ({ request }) => {
        const body = (await request.json()) as { token: string; password: string };
        expect(body.token).toBe('tok123');
        expect(body.password).toBe('NewPass123!');
        return HttpResponse.json({ ok: true });
      }),
    );

    wrap(<ResetPasswordForm token="tok123" />);

    await waitFor(() => {
      expect(screen.getByTestId('new-password-input')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('new-password-input'), {
      target: { value: 'NewPass123!' },
    });
    fireEvent.change(screen.getByTestId('confirm-password-input'), {
      target: { value: 'NewPass123!' },
    });
    fireEvent.click(screen.getByTestId('reset-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('reset-success')).toBeInTheDocument();
    });
  });

  it('renders token error on 410', async () => {
    server.use(
      http.get(`${BASE}/auth/password-reset/validate`, () =>
        HttpResponse.json(
          { title: 'Token expired' },
          { status: 410, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    wrap(<ResetPasswordForm token="bad" />);

    await waitFor(() => {
      expect(screen.getByTestId('reset-token-error')).toBeInTheDocument();
    });
  });
});

describe('<InviteAcceptanceForm>', () => {
  it('submits token + name + password and navigates to /', async () => {
    server.use(
      http.post(`${BASE}/auth/invite/accept`, async ({ request }) => {
        const body = (await request.json()) as Record<string, string>;
        expect(body.token).toBe('inv1');
        expect(body.name).toBe('Jane');
        expect(body.password).toBe('TestRoot1234!');
        return HttpResponse.json(
          { userId: 'u-new', sessionId: 's-new', status: 'created' },
          { status: 201 },
        );
      }),
    );

    wrap(<InviteAcceptanceForm token="inv1" />);
    fireEvent.change(screen.getByTestId('invite-name-input'), {
      target: { value: 'Jane' },
    });
    fireEvent.change(screen.getByTestId('invite-password-input'), {
      target: { value: 'TestRoot1234!' },
    });
    fireEvent.change(screen.getByTestId('invite-confirm-input'), {
      target: { value: 'TestRoot1234!' },
    });
    fireEvent.click(screen.getByTestId('invite-submit'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({ to: '/' });
    });
  });

  it('renders error on 410 token-invalid', async () => {
    server.use(
      http.post(`${BASE}/auth/invite/accept`, () =>
        HttpResponse.json(
          { title: 'Invite invalid' },
          { status: 410, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    wrap(<InviteAcceptanceForm token="bad" />);
    fireEvent.change(screen.getByTestId('invite-name-input'), {
      target: { value: 'X' },
    });
    fireEvent.change(screen.getByTestId('invite-password-input'), {
      target: { value: 'TestRoot1234!' },
    });
    fireEvent.change(screen.getByTestId('invite-confirm-input'), {
      target: { value: 'TestRoot1234!' },
    });
    fireEvent.click(screen.getByTestId('invite-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('invite-error')).toBeInTheDocument();
    });
  });
});

describe('<TotpRecoveryForm>', () => {
  it('shows error when no pending login', async () => {
    wrap(<TotpRecoveryForm />);
    fireEvent.change(screen.getByTestId('backup-code-input'), {
      target: { value: 'BACKUPCODE' },
    });
    fireEvent.click(screen.getByTestId('recovery-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('recovery-error')).toBeInTheDocument();
    });
  });

  it('signs the user in via the backup code path', async () => {
    let calls = 0;
    server.use(
      http.post(`${BASE}/auth/login`, () => {
        calls += 1;
        if (calls === 1) {
          return HttpResponse.json({ requiresTotp: true, userId: 'u20' });
        }
        return HttpResponse.json({
          user: { id: 'u20', username: 'alice', forcePasswordChange: false },
          session: { id: 's20', expiresAt: '2026-12-31T00:00:00Z' },
        });
      }),
    );

    // Seed pending credentials by calling login first.
    await login('alice', 'pw');

    wrap(<TotpRecoveryForm />);
    fireEvent.change(screen.getByTestId('backup-code-input'), {
      target: { value: 'BACKUPCODE' },
    });
    fireEvent.click(screen.getByTestId('recovery-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('recovery-success')).toBeInTheDocument();
    });
  });
});
