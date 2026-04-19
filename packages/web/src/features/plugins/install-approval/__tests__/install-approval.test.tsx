/**
 * Unit tests for InstallApprovalModal + permission-risk helpers.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
}));

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { InstallApprovalModal } from '../components/modal';
import { isAdminLevelPermission, adminLevelPermissions } from '../api';
import type { ApprovalCandidate } from '../types';

function wrap(ui: React.ReactNode) {
  return render(
    <MantineProvider>
      <Notifications />
      <ModalsProvider>{ui}</ModalsProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
});

describe('isAdminLevelPermission', () => {
  it('flags admin:* as admin-level', () => {
    expect(isAdminLevelPermission('admin:cross-tenant-read')).toBe(true);
    expect(isAdminLevelPermission('admin:anything')).toBe(true);
  });

  it('flags rioku:*:write and rioku:*:delete', () => {
    expect(isAdminLevelPermission('rioku:plugins:write')).toBe(true);
    expect(isAdminLevelPermission('rioku:services:delete')).toBe(true);
  });

  it('flags the global wildcard', () => {
    expect(isAdminLevelPermission('*:*:*')).toBe(true);
  });

  it('does not flag plugin-namespaced writes', () => {
    expect(isAdminLevelPermission('com.acme.foo:write')).toBe(false);
    expect(isAdminLevelPermission('io.example.bar:delete')).toBe(false);
  });

  it('does not flag rioku read permissions', () => {
    expect(isAdminLevelPermission('rioku:plugins:read')).toBe(false);
    expect(isAdminLevelPermission('user:read')).toBe(false);
  });
});

describe('adminLevelPermissions', () => {
  it('returns only the admin-level entries, preserving order', () => {
    const input = [
      'com.acme.foo:read',
      'admin:cross-tenant-read',
      'user:invite',
      'rioku:services:delete',
    ];
    const out = adminLevelPermissions(input);
    expect(out).toEqual(['admin:cross-tenant-read', 'rioku:services:delete']);
  });
});

const safeCandidate: ApprovalCandidate = {
  slug: 'com.example.safe',
  display_name: 'Safe Plugin',
  version: '1.0.0',
  signer: 'example.com',
  declared_permissions: ['com.example.safe:read'],
  parts: ['admin'],
  reference: 'oci://ghcr.io/example/safe:1.0.0',
  manifest: { slug: 'com.example.safe' },
};

const riskyCandidate: ApprovalCandidate = {
  slug: 'com.example.risky',
  display_name: 'Risky Plugin',
  version: '0.1.0',
  signer: 'unverified',
  declared_permissions: ['com.example.risky:read', 'admin:cross-tenant-write'],
  parts: ['daemon', 'admin'],
  reference: 'oci://ghcr.io/example/risky:0.1.0',
  manifest: { slug: 'com.example.risky', zones: ['dashboard.summary'] },
};

describe('InstallApprovalModal — approve path', () => {
  it('enables Approve immediately for safe candidates', async () => {
    const onApprove = vi.fn();
    wrap(
      <InstallApprovalModal
        candidate={safeCandidate}
        opened={true}
        onApprove={onApprove}
        onCancel={vi.fn()}
      />,
    );

    const approveBtn = screen.getByRole('button', { name: /Approve.*install/i });
    expect((approveBtn as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(approveBtn);

    await waitFor(
      () => {
        expect(onApprove).toHaveBeenCalledOnce();
      },
      { timeout: 2000 },
    );
    const arg = onApprove.mock.calls[0]?.[0] as { slug: string } | undefined;
    expect(arg?.slug).toBe('com.example.safe');
  });

  it('adds the plugin to the mock store after approve', async () => {
    const before = Object.keys(useMockStore.getState().plugins).length;

    const onApprove = vi.fn();
    wrap(
      <InstallApprovalModal
        candidate={safeCandidate}
        opened={true}
        onApprove={onApprove}
        onCancel={vi.fn()}
      />,
    );

    const approveBtn = screen.getByRole('button', { name: /Approve.*install/i });
    fireEvent.click(approveBtn);

    await waitFor(
      () => {
        const after = Object.keys(useMockStore.getState().plugins).length;
        expect(after).toBe(before + 1);
      },
      { timeout: 2000 },
    );
  });
});

describe('InstallApprovalModal — second-confirm path', () => {
  it('disables Approve until the second-confirm checkbox is ticked', () => {
    wrap(
      <InstallApprovalModal
        candidate={riskyCandidate}
        opened={true}
        onApprove={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    // Warning alert is present
    expect(screen.getByText(/Admin-level permissions requested/i)).toBeTruthy();

    const approveBtn = screen.getByRole('button', { name: /Approve.*install/i });
    expect((approveBtn as HTMLButtonElement).disabled).toBe(true);

    const checkbox = screen.getByLabelText(
      /I understand this plugin requests admin-level permissions/i,
    );
    fireEvent.click(checkbox);

    expect((approveBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows an admin-level badge on each admin-tier permission', () => {
    wrap(
      <InstallApprovalModal
        candidate={riskyCandidate}
        opened={true}
        onApprove={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const adminBadges = screen.getAllByText(/^admin-level$/i);
    expect(adminBadges.length).toBeGreaterThanOrEqual(1);
  });
});

describe('InstallApprovalModal — cancel path', () => {
  it('calls onCancel and does not modify the store', () => {
    const before = Object.keys(useMockStore.getState().plugins).length;
    const onCancel = vi.fn();
    wrap(
      <InstallApprovalModal
        candidate={safeCandidate}
        opened={true}
        onApprove={vi.fn()}
        onCancel={onCancel}
      />,
    );

    const declineBtn = screen.getByRole('button', { name: /Decline/i });
    fireEvent.click(declineBtn);

    expect(onCancel).toHaveBeenCalled();
    const after = Object.keys(useMockStore.getState().plugins).length;
    expect(after).toBe(before);
  });
});
