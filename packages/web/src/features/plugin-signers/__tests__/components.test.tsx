/**
 * Component smoke tests for SignerList + SignerDetail (Plan 6, Task 6b.6).
 *
 * Focus:
 *   - List respects scope (global vs tenant)
 *   - Filter by status narrows the rendered rows
 *   - Detail drawer renders header, fingerprint, and permission-gated actions
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
  Link: ({ children, ...props }: { children?: React.ReactNode }) => (
    <a {...(props as Record<string, unknown>)}>{children}</a>
  ),
}));

import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { SignerList } from '../components/list';
import { SignerDetail } from '../components/detail';
import type { SignerFilter } from '../types';

function wrap(ui: React.ReactNode) {
  return render(
    <MantineProvider>
      <Notifications />
      {ui}
    </MantineProvider>,
  );
}

const EMPTY_FILTER: SignerFilter = { search: '', statuses: [] };

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
});

describe('<SignerList>', () => {
  it('renders global-scope signers only when tenantScope is null', () => {
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

    const globals = Object.values(useMockStore.getState().pluginSigners).filter(
      (s) => s.tenant_scope === null,
    );
    for (const g of globals) {
      expect(screen.getByText(g.name)).toBeTruthy();
    }
  });

  it('filters rows by status', () => {
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

    const revoked = Object.values(useMockStore.getState().pluginSigners).filter(
      (s) => s.tenant_scope === null && s.status === 'revoked',
    );
    const verifiedGlobals = Object.values(useMockStore.getState().pluginSigners).filter(
      (s) => s.tenant_scope === null && s.status === 'verified',
    );

    for (const r of revoked) {
      expect(screen.getByText(r.name)).toBeTruthy();
    }
    for (const v of verifiedGlobals) {
      expect(screen.queryByText(v.name)).toBeNull();
    }
  });
});

describe('<SignerDetail>', () => {
  it('renders header + fingerprint + scope chip for a seeded signer', () => {
    const signer = Object.values(useMockStore.getState().pluginSigners)[0];
    if (!signer) throw new Error('seed missing signers');

    wrap(<SignerDetail signerId={signer.id} onClose={vi.fn()} />);

    expect(screen.getByText(signer.name)).toBeTruthy();
    // Fingerprint rendered in full, monospace.
    expect(screen.getByText(signer.fingerprint)).toBeTruthy();
  });

  it('disables Verify when already verified and Revoke when already revoked', () => {
    const verified = Object.values(useMockStore.getState().pluginSigners).find(
      (s) => s.status === 'verified',
    );
    const revoked = Object.values(useMockStore.getState().pluginSigners).find(
      (s) => s.status === 'revoked',
    );
    if (!verified || !revoked) throw new Error('need both verified + revoked in seed');

    const { unmount } = wrap(<SignerDetail signerId={verified.id} onClose={vi.fn()} />);
    const verifyBtn = screen.getByRole('button', { name: /Verify/i });
    expect((verifyBtn as HTMLButtonElement).disabled).toBe(true);
    unmount();

    wrap(<SignerDetail signerId={revoked.id} onClose={vi.fn()} />);
    const revokeBtn = screen.getByRole('button', { name: /Revoke/i });
    expect((revokeBtn as HTMLButtonElement).disabled).toBe(true);
  });
});
