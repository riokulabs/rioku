/**
 * Tests for <AuditDetail>.
 *
 * Covers: renders header + context, payload redaction without
 * audit:read-sensitive, CelDiff shown for policy-write diffs with condition
 * strings, JSON DiffView shown for non-policy diffs, policies-evaluated list,
 * export button.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { subscribeHostEvent } from '@/host/events';

// Shiki mock — payload section uses CodeBlock.
vi.mock('shiki', () => ({
  createHighlighter: vi.fn().mockResolvedValue({
    codeToHtml: vi.fn().mockImplementation((code: string) => {
      return `<pre><code>${code}</code></pre>`;
    }),
  }),
}));

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => () => undefined,
  useRouter: () => ({ navigate: () => undefined }),
}));

let grantSensitive = true;
vi.mock('@/hooks/use-permission', () => ({
  usePermission: (key: string) => (key === 'audit:read-sensitive' ? grantSensitive : true),
}));

import { useMockStore } from '@/api/mock-store';
import { AuditDetail } from '../components/detail';
import type { AuditEntry, ID } from '@/api/resources';

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  return (
    <MantineProvider>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </MantineProvider>
  );
}

function makeEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 'audit-1' as ID,
    tenant_id: 't1' as ID,
    actor_id: 'u1' as ID,
    action: 'service.create',
    resource_type: 'service',
    resource_id: 'srv-001' as ID,
    outcome: 'success',
    at: '2026-04-10T12:34:00.000Z',
    tier: 'write',
    ...overrides,
  };
}

beforeEach(() => {
  grantSensitive = true;
  useMockStore.getState().reset();
  useMockStore.setState({
    users: {
      u1: {
        id: 'u1' as ID,
        email: 'alice@example.com',
        name: 'Alice',
        disabled: false,
        totp_enabled: false,
        totp_enrolled: false,
        timezone: 'America/Los_Angeles',
        locale: 'en',
        reduced_motion: false,
        notification_preferences: { email: true, in_app: true, categories_muted: [] },
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    },
  });
});

describe('<AuditDetail>', () => {
  it('renders action, outcome, tier, and actor name', () => {
    render(<AuditDetail entry={makeEntry()} onClose={() => undefined} />, {
      wrapper: Wrapper,
    });
    expect(screen.getByText('service.create')).toBeInTheDocument();
    expect(screen.getByText('success')).toBeInTheDocument();
    expect(screen.getByText('write')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('hides IP behind reveal flow even when permission is granted', () => {
    render(<AuditDetail entry={makeEntry({ ip: '10.0.0.1' })} onClose={() => undefined} />, {
      wrapper: Wrapper,
    });
    // IP is redacted by default; user must click "Reveal sensitive" + supply
    // a reason to unmask. Validates the reveal-flow gating that records a
    // follow-up audit entry for compliance.
    expect(screen.getByTestId('audit-ip')).toHaveTextContent('[redacted]');
    expect(screen.getByTestId('audit-reveal-sensitive')).toBeInTheDocument();
  });

  it('redacts IP when permission is missing', () => {
    grantSensitive = false;
    render(<AuditDetail entry={makeEntry({ ip: '10.0.0.1' })} onClose={() => undefined} />, {
      wrapper: Wrapper,
    });
    expect(screen.getByTestId('audit-ip')).toHaveTextContent('[redacted]');
    // No reveal button when the user lacks the permission.
    expect(screen.queryByTestId('audit-reveal-sensitive')).not.toBeInTheDocument();
  });

  it('reveal flow requires a reason and emits a host event', async () => {
    const events: unknown[] = [];
    const unsub = subscribeHostEvent('audit:sensitive-revealed', (data) => {
      events.push(data);
    });
    try {
      render(<AuditDetail entry={makeEntry({ ip: '10.0.0.1' })} onClose={() => undefined} />, {
        wrapper: Wrapper,
      });
      // Click "Reveal sensitive" to open the modal.
      fireEvent.click(screen.getByTestId('audit-reveal-sensitive'));
      const reasonInput = await screen.findByTestId('audit-reveal-reason');
      // Empty reason — confirm should be rejected with an error.
      fireEvent.click(screen.getByTestId('audit-reveal-confirm'));
      expect(events).toHaveLength(0);
      expect(screen.getByTestId('audit-ip')).toHaveTextContent('[redacted]');
      // Provide a valid reason and confirm.
      fireEvent.change(reasonInput, { target: { value: 'Investigating incident #42' } });
      fireEvent.click(screen.getByTestId('audit-reveal-confirm'));
      await waitFor(() => {
        expect(events).toHaveLength(1);
      });
      expect(events[0]).toMatchObject({
        entry_id: 'audit-1',
        reason: 'Investigating incident #42',
      });
      expect(screen.getByTestId('audit-ip')).toHaveTextContent('10.0.0.1');
    } finally {
      unsub();
    }
  });

  it('renders CelDiff when action is a policy write and condition strings differ', () => {
    render(
      <AuditDetail
        entry={makeEntry({
          action: 'access-policy.update',
          diff: {
            before: { condition: 'request.user == "alice"' },
            after: { condition: 'request.user == "bob"' },
          },
        })}
        onClose={() => undefined}
      />,
      { wrapper: Wrapper },
    );
    expect(screen.getByTestId('cel-diff')).toBeInTheDocument();
  });

  it('falls back to JSON DiffView when the diff is not a policy condition', () => {
    render(
      <AuditDetail
        entry={makeEntry({
          action: 'service.update',
          diff: {
            before: { name: 'old' },
            after: { name: 'new' },
          },
        })}
        onClose={() => undefined}
      />,
      { wrapper: Wrapper },
    );
    expect(screen.getByTestId('diff-view')).toBeInTheDocument();
    expect(screen.queryByTestId('cel-diff')).not.toBeInTheDocument();
  });

  it('renders policies-evaluated list with decision chips', () => {
    render(
      <AuditDetail
        entry={makeEntry({
          policies_evaluated: [
            { policy_id: 'p-1' as ID, decision: 'allow', reason: 'role match' },
            { policy_id: 'p-2' as ID, decision: 'deny', reason: 'scope too narrow' },
          ],
        })}
        onClose={() => undefined}
      />,
      { wrapper: Wrapper },
    );
    expect(screen.getByTestId('audit-policies-section')).toBeInTheDocument();
    expect(screen.getByText('allow')).toBeInTheDocument();
    expect(screen.getByText('deny')).toBeInTheDocument();
    expect(screen.getByText('role match')).toBeInTheDocument();
  });

  it('renders super-admin banner when acted_as_admin is true', () => {
    render(<AuditDetail entry={makeEntry({ acted_as_admin: true })} onClose={() => undefined} />, {
      wrapper: Wrapper,
    });
    expect(screen.getByTestId('audit-admin-banner')).toBeInTheDocument();
  });

  it('Export button renders', () => {
    render(<AuditDetail entry={makeEntry()} onClose={() => undefined} />, {
      wrapper: Wrapper,
    });
    expect(screen.getByTestId('audit-export-json')).toBeInTheDocument();
  });
});
