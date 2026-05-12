/**
 * Component smoke tests for SignerList + SignerDetail (Stage 2 — real API).
 *
 * Components now use TanStack Query backed by the real daemon endpoints.
 * MSW intercepts the fetch calls in tests. QueryClientProvider wraps all
 * rendered components.
 *
 * Focus:
 *   - List renders signers returned by the API
 *   - List filters by status on the client side
 *   - Detail drawer renders header + fingerprint for a given signer
 *   - Verify/Revoke buttons are disabled based on current status
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
  Link: ({ children, ...props }: { children?: React.ReactNode }) => <a {...props}>{children}</a>,
}));

import { render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';
import { SignerList } from '../components/list';
import { SignerDetail } from '../components/detail';
import type { SignerFilter } from '../types';

const SHA256_FP = 'a'.repeat(64);
const SHA256_FP_B = 'b'.repeat(64);

// ─── Test data ────────────────────────────────────────────────────────────────

const GLOBAL_SIGNERS = [
  {
    id: 'signer-global-1',
    tenantScope: null,
    name: 'Rioku Labs',
    fingerprint: SHA256_FP,
    status: 'verified',
    notes: 'Official Rioku key',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'signer-global-2',
    tenantScope: null,
    name: 'Revoked Publisher',
    fingerprint: SHA256_FP_B,
    status: 'revoked',
    notes: 'Deprecated key',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
] as const;

const TENANT_SIGNERS = [
  {
    id: 'signer-tenant-1',
    tenantScope: 'tenant-abc',
    name: 'Acme Internal',
    fingerprint: SHA256_FP,
    status: 'pending',
    notes: 'Awaiting review',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
] as const;

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function wrap(ui: React.ReactNode, qc = makeQueryClient()) {
  return render(
    <QueryClientProvider client={qc}>
      <MantineProvider>
        <Notifications />
        {ui}
      </MantineProvider>
    </QueryClientProvider>,
  );
}

const EMPTY_FILTER: SignerFilter = { search: '', statuses: [] };

beforeEach(() => {
  server.resetHandlers();
});

// ─── SignerList tests ─────────────────────────────────────────────────────────

describe('<SignerList>', () => {
  it('renders global-scope signers returned by /admin/plugin-signers', async () => {
    server.use(
      http.get('/api/v1/admin/plugin-signers', () =>
        HttpResponse.json({ items: GLOBAL_SIGNERS, total: GLOBAL_SIGNERS.length }),
      ),
    );

    wrap(
      <SignerList
        tenantScope={null}
        filter={EMPTY_FILTER}
        onSelect={vi.fn()}
        onVerify={vi.fn()}
        onRevoke={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Rioku Labs')).toBeTruthy();
      expect(screen.getByText('Revoked Publisher')).toBeTruthy();
    });
  });

  it('filters rows by status (client-side filtering)', async () => {
    server.use(
      http.get('/api/v1/admin/plugin-signers', () =>
        HttpResponse.json({ items: GLOBAL_SIGNERS, total: GLOBAL_SIGNERS.length }),
      ),
    );

    wrap(
      <SignerList
        tenantScope={null}
        filter={{ search: '', statuses: ['revoked'] }}
        onSelect={vi.fn()}
        onVerify={vi.fn()}
        onRevoke={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Revoked Publisher')).toBeTruthy();
    });
    // Verified signer should not appear when filtered to revoked only
    expect(screen.queryByText('Rioku Labs')).toBeNull();
  });

  it('renders tenant-scoped signers from /t/{tenant}/plugin-signers', async () => {
    server.use(
      http.get('/api/v1/t/tenant-abc/plugin-signers', () =>
        HttpResponse.json({ items: TENANT_SIGNERS, total: TENANT_SIGNERS.length }),
      ),
    );

    wrap(
      <SignerList
        tenantScope="tenant-abc"
        filter={EMPTY_FILTER}
        onSelect={vi.fn()}
        onVerify={vi.fn()}
        onRevoke={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Acme Internal')).toBeTruthy();
    });
  });
});

// ─── SignerDetail tests ───────────────────────────────────────────────────────

describe('<SignerDetail>', () => {
  it('renders header + fingerprint for a verified signer', async () => {
    const signer = GLOBAL_SIGNERS[0];
    server.use(
      http.get(`/api/v1/admin/plugin-signers/${signer.id}`, () => HttpResponse.json(signer)),
      http.get(`/api/v1/admin/plugin-signers/${signer.id}/plugins`, () =>
        HttpResponse.json({ items: [], total: 0 }),
      ),
    );

    wrap(<SignerDetail signerId={signer.id} tenantId="t-test" onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(signer.name)).toBeTruthy();
    });
    expect(screen.getByText(signer.fingerprint)).toBeTruthy();
  });

  it('disables Verify when already verified', async () => {
    const signer = GLOBAL_SIGNERS[0]; // verified
    server.use(
      http.get(`/api/v1/admin/plugin-signers/${signer.id}`, () => HttpResponse.json(signer)),
      http.get(`/api/v1/admin/plugin-signers/${signer.id}/plugins`, () =>
        HttpResponse.json({ items: [], total: 0 }),
      ),
    );

    wrap(<SignerDetail signerId={signer.id} tenantId="t-test" onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(signer.name)).toBeTruthy();
    });

    const verifyBtn = screen.getByRole('button', { name: /Verify/i });
    expect((verifyBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables Revoke when already revoked', async () => {
    const signer = GLOBAL_SIGNERS[1]; // revoked
    server.use(
      http.get(`/api/v1/admin/plugin-signers/${signer.id}`, () => HttpResponse.json(signer)),
      http.get(`/api/v1/admin/plugin-signers/${signer.id}/plugins`, () =>
        HttpResponse.json({ items: [], total: 0 }),
      ),
    );

    wrap(<SignerDetail signerId={signer.id} tenantId="t-test" onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(signer.name)).toBeTruthy();
    });

    const revokeBtn = screen.getByRole('button', { name: /Revoke/i });
    expect((revokeBtn as HTMLButtonElement).disabled).toBe(true);
  });
});
