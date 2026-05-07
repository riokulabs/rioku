import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { App } from './app';
import { server } from '@/test/msw-server';
import { queryClient } from '@/api/query-client';

const BASE = '/api/v1';

describe('App', () => {
  beforeEach(() => {
    // The daemon-backed router-guard reads /auth/bootstrap-status and
    // /auth/me on first load. Stub both so the guard waves the user through
    // to the tenants picker without any local state shenanigans.
    queryClient.clear();
    server.use(
      http.get(`${BASE}/auth/bootstrap-status`, () => HttpResponse.json({ required: false })),
      http.get(`${BASE}/auth/me`, () =>
        HttpResponse.json({
          user: {
            id: 'u1',
            username: 'derrick',
            displayName: 'Derrick',
            email: 'derrick@rioku.dev',
            roles: ['superadmin'],
            permissions: [],
            status: 'active',
            createdAt: '2026-01-01T00:00:00Z',
            forcePasswordChange: false,
            totpEnabled: true,
          },
          session: { id: 's1', expiresAt: '2026-12-31T00:00:00Z' },
        }),
      ),
    );
  });

  it('renders the tenants page after root redirect', async () => {
    render(<App />);
    expect(await screen.findByRole('heading', { name: /tenants/i })).toBeInTheDocument();
  });
});
