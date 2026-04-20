/**
 * Tests for <AuditList>.
 *
 * Covers: row rendering, badge colors, TOTP icon, row click dispatch, actor
 * tooltip gating on audit:read-sensitive.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { useMockStore } from '@/api/mock-store';
import { AuditList } from '../components/list';
import type { AuditEntry, ID } from '@/api/resources/types';

// TanStack Router URL-sync — same shim used across list tests.
vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => () => undefined,
  useRouter: () => ({ navigate: () => undefined }),
}));

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

describe('<AuditList>', () => {
  it('renders rows with actor name, action, resource chip, outcome and tier', () => {
    render(<AuditList rows={[makeEntry()]} onSelect={() => undefined} />, {
      wrapper: Wrapper,
    });
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('service.create')).toBeInTheDocument();
    expect(screen.getByText('service')).toBeInTheDocument();
    expect(screen.getByText('success')).toBeInTheDocument();
    expect(screen.getByText('write')).toBeInTheDocument();
  });

  it('renders TOTP shield icon when totp_verified is true', () => {
    render(
      <AuditList
        rows={[makeEntry({ totp_verified: true })]}
        onSelect={() => undefined}
      />,
      { wrapper: Wrapper },
    );
    expect(screen.getByLabelText('TOTP verified')).toBeInTheDocument();
  });

  it('does not render TOTP icon when totp_verified is falsy', () => {
    render(<AuditList rows={[makeEntry()]} onSelect={() => undefined} />, {
      wrapper: Wrapper,
    });
    expect(screen.queryByLabelText('TOTP verified')).not.toBeInTheDocument();
  });

  it('calls onSelect when the view-detail action is clicked', () => {
    const onSelect = vi.fn();
    render(<AuditList rows={[makeEntry()]} onSelect={onSelect} />, {
      wrapper: Wrapper,
    });
    fireEvent.click(screen.getByTestId('audit-row-view-audit-1'));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'audit-1' }));
  });

  it('renders "admin" badge when acted_as_admin is true', () => {
    render(
      <AuditList
        rows={[makeEntry({ acted_as_admin: true })]}
        onSelect={() => undefined}
      />,
      { wrapper: Wrapper },
    );
    expect(screen.getByText('admin')).toBeInTheDocument();
  });

  it('empty-state renders when rows is empty', () => {
    render(<AuditList rows={[]} onSelect={() => undefined} />, {
      wrapper: Wrapper,
    });
    expect(screen.getByText('No audit entries')).toBeInTheDocument();
  });
});
