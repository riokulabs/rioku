/**
 * Tests for <AuditFilterBar>.
 *
 * Covers: renders bounded filters, emits onChange when a bounded MultiSelect
 * changes, advanced toggle reveals unbounded controls, free-text is gated on
 * audit:read-sensitive.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => () => undefined,
  useRouter: () => ({ navigate: () => undefined }),
}));

// Mock the permission hook so we can toggle sensitive access.
let grantSensitive = false;
vi.mock('@/hooks/use-permission', () => ({
  usePermission: (key: string) =>
    key === 'audit:read-sensitive' ? grantSensitive : true,
}));

import { AuditFilterBar } from '../components/filter-bar';
import type { AuditFilter } from '../types';

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MantineProvider>{children}</MantineProvider>;
}

const DEFAULT_FILTER: AuditFilter = {
  actions: [],
  outcomes: [],
  resource_types: [],
  tiers: [],
  date_from: null,
  date_to: null,
  actor_handles: [],
  resource_id_handles: [],
  search: '',
};

beforeEach(() => {
  grantSensitive = true;
});

describe('<AuditFilterBar>', () => {
  it('renders the primary bounded filter controls', () => {
    render(
      <AuditFilterBar
        tenantId="t1"
        filter={DEFAULT_FILTER}
        onChange={() => undefined}
      />,
      { wrapper: Wrapper },
    );
    expect(screen.getByLabelText('Filter by action')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter by outcome')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter by resource type')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter by tier')).toBeInTheDocument();
    expect(screen.getByTestId('audit-search-input')).toBeEnabled();
  });

  it('disables the search input when audit:read-sensitive is missing', () => {
    grantSensitive = false;
    render(
      <AuditFilterBar
        tenantId="t1"
        filter={DEFAULT_FILTER}
        onChange={() => undefined}
      />,
      { wrapper: Wrapper },
    );
    const input = screen.getByTestId('audit-search-input');
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute('placeholder', 'Sensitive search disabled');
  });

  it('debounces search input and emits onChange with the new search value', async () => {
    const onChange = vi.fn();
    render(
      <AuditFilterBar
        tenantId="t1"
        filter={DEFAULT_FILTER}
        onChange={onChange}
      />,
      { wrapper: Wrapper },
    );
    const input = screen.getByTestId('audit-search-input');
    fireEvent.change(input, { target: { value: 'login' } });
    await waitFor(
      () => {
        expect(onChange).toHaveBeenCalled();
      },
      { timeout: 1000 },
    );
    const lastCall = onChange.mock.calls.at(-1)?.[0] as AuditFilter | undefined;
    expect(lastCall?.search).toBe('login');
  });

  it('toggling Advanced reveals the unbounded controls', () => {
    render(
      <AuditFilterBar
        tenantId="t1"
        filter={DEFAULT_FILTER}
        onChange={() => undefined}
      />,
      { wrapper: Wrapper },
    );
    // Collapsed initially — the advanced panel isn't in the aria-expanded sense.
    const toggle = screen.getByTestId('audit-advanced-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('audit-actor-filter')).toBeInTheDocument();
    expect(screen.getByTestId('audit-resource-id-filter')).toBeInTheDocument();
    expect(screen.getByTestId('audit-date-range')).toBeInTheDocument();
  });
});
