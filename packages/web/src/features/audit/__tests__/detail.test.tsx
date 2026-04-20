/**
 * Tests for <AuditDetail>.
 *
 * Covers: renders header + context, payload redaction without
 * audit:read-sensitive, CelDiff shown for policy-write diffs with condition
 * strings, JSON DiffView shown for non-policy diffs, policies-evaluated list,
 * export button.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

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
  usePermission: (key: string) =>
    key === 'audit:read-sensitive' ? grantSensitive : true,
}));

import { useMockStore } from '@/api/mock-store';
import { AuditDetail } from '../components/detail';
import type { AuditEntry, ID } from '@/api/resources/types';

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MantineProvider>{children}</MantineProvider>;
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

  it('shows IP when permission is granted', () => {
    render(
      <AuditDetail
        entry={makeEntry({ ip: '10.0.0.1' })}
        onClose={() => undefined}
      />,
      { wrapper: Wrapper },
    );
    expect(screen.getByTestId('audit-ip')).toHaveTextContent('10.0.0.1');
  });

  it('redacts IP when permission is missing', () => {
    grantSensitive = false;
    render(
      <AuditDetail
        entry={makeEntry({ ip: '10.0.0.1' })}
        onClose={() => undefined}
      />,
      { wrapper: Wrapper },
    );
    expect(screen.getByTestId('audit-ip')).toHaveTextContent('[redacted]');
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
    render(
      <AuditDetail
        entry={makeEntry({ acted_as_admin: true })}
        onClose={() => undefined}
      />,
      { wrapper: Wrapper },
    );
    expect(screen.getByTestId('audit-admin-banner')).toBeInTheDocument();
  });

  it('close button fires onClose', () => {
    const onClose = vi.fn();
    render(<AuditDetail entry={makeEntry()} onClose={onClose} />, {
      wrapper: Wrapper,
    });
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('Export button renders', () => {
    render(<AuditDetail entry={makeEntry()} onClose={() => undefined} />, {
      wrapper: Wrapper,
    });
    expect(screen.getByTestId('audit-export-json')).toBeInTheDocument();
  });
});
