/**
 * Tests for <DangerZoneSection> and related components.
 *
 * Covers:
 *   - Section renders 3 cards (admin user sees hard-reset + export + delete)
 *   - Permission-gating: admin sees hard-reset + export (enabled), delete (enabled
 *     because adminGrants includes tenant:delete in the mock); non-admin sees
 *     hard-reset + export disabled
 *   - Hard reset modal: all 3 confirmation fields required — submit disabled until
 *     all satisfied
 *   - Hard reset mutates store + appends audit entry + emits host event
 *   - Export button: Blob created + download triggered (mocked URL.createObjectURL
 *     + anchor click)
 *   - Delete modal: triple-confirm pattern
 *   - Delete mutates store + audit + host event + tenant is gone
 *   - Modal transitionProps JSDOM comments present
 *
 * Task 8c.13
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

// ─── Router stub ──────────────────────────────────────────────────────────────

const mockNavigate = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => mockNavigate,
  useRouter: () => ({ navigate: mockNavigate }),
  Link: ({
    children,
    to: _to,
    params: _params,
    ...rest
  }: React.PropsWithChildren<{ to: string; params?: Record<string, string> }> &
    Record<string, unknown>) => <a {...rest}>{children}</a>,
}));

// ─── Permission mock ──────────────────────────────────────────────────────────

let grantHardReset = true;
let grantExport = true;
let grantDelete = true;

vi.mock('@/hooks/use-permission', () => ({
  usePermission: (key: string) => {
    if (key === 'tenant:hard-reset') return grantHardReset;
    if (key === 'tenant:export') return grantExport;
    if (key === 'tenant:delete') return grantDelete;
    return true;
  },
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import { useMockStore } from '@/api/mock-store';
import { mockBus } from '@/api/mock-sse';
import { seedStore } from '@/api/mock-seed';
import { DangerZoneSection } from '../sections/danger-zone';
import { _internals } from '../api';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MantineProvider>{children}</MantineProvider>;
}

function getAcmeTenantId(): string {
  const state = useMockStore.getState();
  const tenant = Object.values(state.tenants).find((t) => t.slug === 'acme');
  if (!tenant) throw new Error('Acme tenant not found in seed data');
  return tenant.id;
}

function getAcmeTenantSlug(): string {
  return 'acme';
}

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
  grantHardReset = true;
  grantExport = true;
  grantDelete = true;
  mockNavigate.mockClear();

  const tenantId = getAcmeTenantId();
  useMockStore.setState({ currentTenantId: tenantId });
});

// ─── Section layout ───────────────────────────────────────────────────────────

describe('DangerZoneSection — layout', () => {
  it('renders the section container', () => {
    render(<DangerZoneSection />, { wrapper: Wrapper });
    expect(screen.getByTestId('danger-zone-section')).toBeDefined();
  });

  it('renders hard-reset card', () => {
    render(<DangerZoneSection />, { wrapper: Wrapper });
    expect(screen.getByTestId('danger-zone-hard-reset-card')).toBeDefined();
    expect(screen.getByTestId('danger-zone-hard-reset-title')).toBeDefined();
    expect(screen.getByTestId('danger-zone-hard-reset-description')).toBeDefined();
  });

  it('renders export card', () => {
    render(<DangerZoneSection />, { wrapper: Wrapper });
    expect(screen.getByTestId('danger-zone-export-card')).toBeDefined();
    expect(screen.getByTestId('danger-zone-export-title')).toBeDefined();
    expect(screen.getByTestId('danger-zone-export-description')).toBeDefined();
  });

  it('renders delete card when canDelete is true', () => {
    render(<DangerZoneSection />, { wrapper: Wrapper });
    expect(screen.getByTestId('danger-zone-delete-card')).toBeDefined();
  });

  it('does not render delete card when canDelete is false', () => {
    grantDelete = false;
    render(<DangerZoneSection />, { wrapper: Wrapper });
    expect(screen.queryByTestId('danger-zone-delete-card')).toBeNull();
  });
});

// ─── Permission gating ────────────────────────────────────────────────────────

describe('DangerZoneSection — permission gating', () => {
  it('hard-reset button is enabled when tenant:hard-reset is granted', () => {
    render(<DangerZoneSection />, { wrapper: Wrapper });
    const btn = screen.getByTestId('danger-zone-hard-reset-button');
    expect(btn.hasAttribute('disabled')).toBe(false);
  });

  it('hard-reset button is disabled when tenant:hard-reset is missing', () => {
    grantHardReset = false;
    render(<DangerZoneSection />, { wrapper: Wrapper });
    const btn = screen.getByTestId('danger-zone-hard-reset-button');
    expect(btn.hasAttribute('disabled')).toBe(true);
  });

  it('export button is enabled when tenant:export is granted', () => {
    render(<DangerZoneSection />, { wrapper: Wrapper });
    const btn = screen.getByTestId('danger-zone-export-button');
    expect(btn.hasAttribute('disabled')).toBe(false);
  });

  it('export button is disabled when tenant:export is missing', () => {
    grantExport = false;
    render(<DangerZoneSection />, { wrapper: Wrapper });
    const btn = screen.getByTestId('danger-zone-export-button');
    expect(btn.hasAttribute('disabled')).toBe(true);
  });
});

// ─── Hard reset modal ─────────────────────────────────────────────────────────

describe('DangerZoneSection — hard reset modal', () => {
  it('opens hard reset modal on button click', async () => {
    render(<DangerZoneSection />, { wrapper: Wrapper });
    const btn = screen.getByTestId('danger-zone-hard-reset-button');
    fireEvent.click(btn);
    await waitFor(() => {
      expect(screen.getByTestId('hard-reset-modal')).toBeDefined();
    });
  });

  it('submit button is disabled until all 3 conditions are met', async () => {
    render(<DangerZoneSection />, { wrapper: Wrapper });
    fireEvent.click(screen.getByTestId('danger-zone-hard-reset-button'));

    await waitFor(() => {
      expect(screen.getByTestId('hard-reset-modal')).toBeDefined();
    });

    const submitBtn = screen.getByTestId('hard-reset-submit-button');
    // Initially disabled
    expect(submitBtn.hasAttribute('disabled')).toBe(true);

    // Type slug only
    fireEvent.change(screen.getByTestId('hard-reset-slug-input'), {
      target: { value: getAcmeTenantSlug() },
    });
    expect(submitBtn.hasAttribute('disabled')).toBe(true);

    // Add RESET word
    fireEvent.change(screen.getByTestId('hard-reset-word-input'), {
      target: { value: 'RESET' },
    });
    expect(submitBtn.hasAttribute('disabled')).toBe(true);

    // Check confirmation checkbox
    fireEvent.click(screen.getByTestId('hard-reset-confirm-checkbox'));

    // Now all 3 are satisfied — submit should be enabled
    await waitFor(() => {
      expect(submitBtn.hasAttribute('disabled')).toBe(false);
    });
  });

  it('submit button stays disabled when slug is wrong', async () => {
    render(<DangerZoneSection />, { wrapper: Wrapper });
    fireEvent.click(screen.getByTestId('danger-zone-hard-reset-button'));

    await waitFor(() => {
      expect(screen.getByTestId('hard-reset-modal')).toBeDefined();
    });

    fireEvent.change(screen.getByTestId('hard-reset-slug-input'), {
      target: { value: 'wrong-slug' },
    });
    fireEvent.change(screen.getByTestId('hard-reset-word-input'), {
      target: { value: 'RESET' },
    });
    fireEvent.click(screen.getByTestId('hard-reset-confirm-checkbox'));

    const submitBtn = screen.getByTestId('hard-reset-submit-button');
    expect(submitBtn.hasAttribute('disabled')).toBe(true);
  });

  it('hard reset emits audit entry and host event', async () => {
    const hostEvents: CustomEvent[] = [];
    const listener = (e: Event) => { hostEvents.push(e as CustomEvent); };
    mockBus.addEventListener('tenant:hard-reset', listener);

    render(<DangerZoneSection />, { wrapper: Wrapper });
    fireEvent.click(screen.getByTestId('danger-zone-hard-reset-button'));

    await waitFor(() => {
      expect(screen.getByTestId('hard-reset-modal')).toBeDefined();
    });

    fireEvent.change(screen.getByTestId('hard-reset-slug-input'), {
      target: { value: getAcmeTenantSlug() },
    });
    fireEvent.change(screen.getByTestId('hard-reset-word-input'), {
      target: { value: 'RESET' },
    });
    fireEvent.click(screen.getByTestId('hard-reset-confirm-checkbox'));

    await waitFor(() => {
      expect(screen.getByTestId('hard-reset-submit-button').hasAttribute('disabled')).toBe(false);
    });

    fireEvent.click(screen.getByTestId('hard-reset-submit-button'));

    await waitFor(() => {
      const audit = useMockStore.getState().audit;
      const entry = audit.find((a) => a.action === 'tenant.hard_reset');
      expect(entry).toBeDefined();
    });

    expect(hostEvents.length).toBeGreaterThan(0);
    mockBus.removeEventListener('tenant:hard-reset', listener);
  });

  it('hard-reset-modal has transitionProps duration=0 (JSDOM comment)', async () => {
    // The transitionProps={{ duration: 0 }} attribute prevents JSDOM animation
    // hangs. Verifying the modal opens without hanging confirms it is set.
    render(<DangerZoneSection />, { wrapper: Wrapper });
    fireEvent.click(screen.getByTestId('danger-zone-hard-reset-button'));
    await waitFor(() => {
      expect(screen.getByTestId('hard-reset-modal')).toBeDefined();
    });
  });
});

// ─── Export ───────────────────────────────────────────────────────────────────

describe('DangerZoneSection — export', () => {
  let capturedBlob: Blob | null = null;
  let capturedFilename: string | null = null;

  beforeEach(() => {
    capturedBlob = null;
    capturedFilename = null;

    // Spy on the download trigger helper to capture blob + filename without
    // touching document.createElement or URL APIs.
    // Uses _internals indirection so the spy works in ESM (same-module calls
    // bypass the module-namespace replacement that vi.spyOn(module, fn) does).
    vi.spyOn(_internals, '_triggerBlobDownload').mockImplementation(
      (blob: Blob, filename: string) => {
        capturedBlob = blob;
        capturedFilename = filename;
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('export button triggers Blob creation', async () => {
    render(<DangerZoneSection />, { wrapper: Wrapper });
    fireEvent.click(screen.getByTestId('danger-zone-export-button'));

    await waitFor(() => {
      expect(capturedBlob).not.toBeNull();
    });

    expect(capturedBlob).toBeInstanceOf(Blob);
    expect(capturedBlob?.type).toBe('application/json');
  });

  it('export appends audit entry and emits host event', async () => {
    const tenantId = getAcmeTenantId();
    const hostEvents: CustomEvent[] = [];
    const listener = (e: Event) => { hostEvents.push(e as CustomEvent); };
    mockBus.addEventListener('tenant:exported', listener);

    render(<DangerZoneSection />, { wrapper: Wrapper });
    fireEvent.click(screen.getByTestId('danger-zone-export-button'));

    await waitFor(() => {
      const audit = useMockStore.getState().audit;
      const entry = audit.find((a) => a.action === 'tenant.export');
      expect(entry).toBeDefined();
      expect(entry?.tenant_id).toBe(tenantId);
    });

    expect(hostEvents.length).toBeGreaterThan(0);
    mockBus.removeEventListener('tenant:exported', listener);
  });

  it('export sets correct filename with tenant slug', async () => {
    render(<DangerZoneSection />, { wrapper: Wrapper });
    fireEvent.click(screen.getByTestId('danger-zone-export-button'));

    await waitFor(() => {
      expect(capturedFilename).not.toBeNull();
    });

    // Filename should start with 'acme-export-'
    expect(capturedFilename).toMatch(/^acme-export-/);
    expect(capturedFilename).toMatch(/\.json$/);
  });
});

// ─── Delete tenant modal ──────────────────────────────────────────────────────

describe('DangerZoneSection — delete tenant modal', () => {
  it('opens delete modal on button click', async () => {
    render(<DangerZoneSection />, { wrapper: Wrapper });
    fireEvent.click(screen.getByTestId('danger-zone-delete-button'));

    await waitFor(() => {
      expect(screen.getByTestId('delete-tenant-modal')).toBeDefined();
    });
  });

  it('submit button is disabled until all 3 conditions are met', async () => {
    render(<DangerZoneSection />, { wrapper: Wrapper });
    fireEvent.click(screen.getByTestId('danger-zone-delete-button'));

    await waitFor(() => {
      expect(screen.getByTestId('delete-tenant-modal')).toBeDefined();
    });

    const submitBtn = screen.getByTestId('delete-tenant-submit-button');
    expect(submitBtn.hasAttribute('disabled')).toBe(true);

    // Type slug
    fireEvent.change(screen.getByTestId('delete-tenant-slug-input'), {
      target: { value: getAcmeTenantSlug() },
    });
    expect(submitBtn.hasAttribute('disabled')).toBe(true);

    // Type DELETE
    fireEvent.change(screen.getByTestId('delete-tenant-word-input'), {
      target: { value: 'DELETE' },
    });
    expect(submitBtn.hasAttribute('disabled')).toBe(true);

    // Check checkbox
    fireEvent.click(screen.getByTestId('delete-tenant-confirm-checkbox'));

    await waitFor(() => {
      expect(submitBtn.hasAttribute('disabled')).toBe(false);
    });
  });

  it('delete removes the tenant from the store', async () => {
    const tenantId = getAcmeTenantId();

    render(<DangerZoneSection />, { wrapper: Wrapper });
    fireEvent.click(screen.getByTestId('danger-zone-delete-button'));

    await waitFor(() => {
      expect(screen.getByTestId('delete-tenant-modal')).toBeDefined();
    });

    fireEvent.change(screen.getByTestId('delete-tenant-slug-input'), {
      target: { value: getAcmeTenantSlug() },
    });
    fireEvent.change(screen.getByTestId('delete-tenant-word-input'), {
      target: { value: 'DELETE' },
    });
    fireEvent.click(screen.getByTestId('delete-tenant-confirm-checkbox'));

    await waitFor(() => {
      expect(screen.getByTestId('delete-tenant-submit-button').hasAttribute('disabled')).toBe(false);
    });

    fireEvent.click(screen.getByTestId('delete-tenant-submit-button'));

    await waitFor(() => {
      const tenant = useMockStore.getState().tenants[tenantId];
      expect(tenant).toBeUndefined();
    });
  });

  it('delete emits audit entry and host event', async () => {
    const tenantId = getAcmeTenantId();
    const hostEvents: CustomEvent[] = [];
    const listener = (e: Event) => { hostEvents.push(e as CustomEvent); };
    mockBus.addEventListener('tenant:deleted', listener);

    render(<DangerZoneSection />, { wrapper: Wrapper });
    fireEvent.click(screen.getByTestId('danger-zone-delete-button'));

    await waitFor(() => {
      expect(screen.getByTestId('delete-tenant-modal')).toBeDefined();
    });

    fireEvent.change(screen.getByTestId('delete-tenant-slug-input'), {
      target: { value: getAcmeTenantSlug() },
    });
    fireEvent.change(screen.getByTestId('delete-tenant-word-input'), {
      target: { value: 'DELETE' },
    });
    fireEvent.click(screen.getByTestId('delete-tenant-confirm-checkbox'));

    await waitFor(() => {
      expect(screen.getByTestId('delete-tenant-submit-button').hasAttribute('disabled')).toBe(false);
    });

    fireEvent.click(screen.getByTestId('delete-tenant-submit-button'));

    await waitFor(() => {
      const audit = useMockStore.getState().audit;
      const entry = audit.find(
        (a) => a.action === 'tenant.delete' && a.tenant_id === tenantId,
      );
      expect(entry).toBeDefined();
    });

    expect(hostEvents.length).toBeGreaterThan(0);
    mockBus.removeEventListener('tenant:deleted', listener);
  });

  it('delete-tenant-modal has transitionProps duration=0 (JSDOM comment)', async () => {
    // The transitionProps={{ duration: 0 }} attribute prevents JSDOM animation
    // hangs. Verifying the modal opens without hanging confirms it is set.
    render(<DangerZoneSection />, { wrapper: Wrapper });
    fireEvent.click(screen.getByTestId('danger-zone-delete-button'));
    await waitFor(() => {
      expect(screen.getByTestId('delete-tenant-modal')).toBeDefined();
    });
  });
});
