/**
 * Unit tests for <LiveTailBadge> + useAuditStream.
 *
 * Mirrors the Plan 3d trace-store streaming-tail test so the two
 * features share a consistent lifecycle contract.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
}));

import { render, renderHook, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { publishAudit } from '@/api/audit-stream-bus';
import type { AuditEntry } from '@/api/resources';
import { LiveTailBadge, useAuditStream } from '../components/streaming-tail';

function wrap(ui: React.ReactNode) {
  return render(
    <MantineProvider>
      <ModalsProvider>{ui}</ModalsProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
});

function acmeId(): string {
  const acme = Object.values(useMockStore.getState().tenants).find((t) => t.slug === 'acme');
  if (!acme) throw new Error('No acme tenant');
  return acme.id;
}

function synthEntry(tenantId: string, id: string): AuditEntry {
  return {
    id,
    tenant_id: tenantId,
    actor_id: 'u_test',
    action: 'test.action',
    resource_type: 'test',
    resource_id: 'r_test',
    outcome: 'success',
    at: new Date().toISOString(),
    tier: 'read',
  };
}

describe('LiveTailBadge', () => {
  it('renders "LIVE" with no counter when newCount is 0', () => {
    wrap(<LiveTailBadge newCount={0} isLive />);
    const badge = screen.getByTestId('audit-live-badge');
    expect(badge.textContent).toContain('LIVE');
    expect(badge.textContent).not.toContain('+');
  });

  it('renders the counter when newCount > 0', () => {
    wrap(<LiveTailBadge newCount={7} isLive />);
    const badge = screen.getByTestId('audit-live-badge');
    expect(badge.textContent).toContain('LIVE');
    expect(badge.textContent).toContain('+7');
  });

  it('renders "Paused" with no counter when isLive is false', () => {
    wrap(<LiveTailBadge newCount={3} isLive={false} />);
    const badge = screen.getByTestId('audit-live-badge');
    expect(badge.textContent).toContain('Paused');
    expect(badge.textContent).not.toContain('+');
    expect(badge.textContent).not.toContain('LIVE');
  });

  it('uses role=status with aria-live=polite for screen reader updates', () => {
    wrap(<LiveTailBadge newCount={2} isLive />);
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.getAttribute('aria-atomic')).toBe('true');
  });
});

describe('useAuditStream', () => {
  it('invokes onEntry when an entry is published while enabled', () => {
    const tenantId = acmeId();
    const onEntry = vi.fn();
    renderHook(() => {
      useAuditStream(tenantId, true, onEntry);
    });

    publishAudit(synthEntry(tenantId, 'a1'));
    expect(onEntry).toHaveBeenCalledTimes(1);
    expect(onEntry).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }));
  });

  it('does not invoke onEntry when disabled', () => {
    const tenantId = acmeId();
    const onEntry = vi.fn();
    renderHook(() => {
      useAuditStream(tenantId, false, onEntry);
    });

    publishAudit(synthEntry(tenantId, 'a2'));
    expect(onEntry).not.toHaveBeenCalled();
  });

  it('ignores entries for other tenants', () => {
    const tenantId = acmeId();
    const onEntry = vi.fn();
    renderHook(() => {
      useAuditStream(tenantId, true, onEntry);
    });

    publishAudit(synthEntry('tenant-other', 'a3'));
    expect(onEntry).not.toHaveBeenCalled();
  });

  it('unsubscribes cleanly on unmount', () => {
    const tenantId = acmeId();
    const onEntry = vi.fn();
    const hook = renderHook(() => {
      useAuditStream(tenantId, true, onEntry);
    });

    publishAudit(synthEntry(tenantId, 'a4'));
    hook.unmount();
    publishAudit(synthEntry(tenantId, 'a5'));
    expect(onEntry).toHaveBeenCalledTimes(1);
  });

  it('re-subscribes on enable toggle', () => {
    const tenantId = acmeId();
    const onEntry = vi.fn();
    let enabled = false;
    const hook = renderHook(() => {
      useAuditStream(tenantId, enabled, onEntry);
    });

    publishAudit(synthEntry(tenantId, 'a6'));
    expect(onEntry).not.toHaveBeenCalled();

    enabled = true;
    hook.rerender();

    publishAudit(synthEntry(tenantId, 'a7'));
    expect(onEntry).toHaveBeenCalledTimes(1);

    enabled = false;
    hook.rerender();

    publishAudit(synthEntry(tenantId, 'a8'));
    expect(onEntry).toHaveBeenCalledTimes(1);
  });
});
