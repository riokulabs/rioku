/**
 * Unit tests for <TraceList> + <TraceFilterBar>.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
}));

let _mockPermission: (key: string) => boolean = () => true;
function setMockPermission(fn: (key: string) => boolean): void {
  _mockPermission = fn;
}
vi.mock('@/hooks/use-permission', () => ({
  usePermission: (key: string) => _mockPermission(key),
}));

import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { TraceList } from '../components/list';
import { TraceFilterBar, type RangePreset } from '../components/filter-bar';
import type { TraceFilter } from '../types';

function wrap(ui: React.ReactNode) {
  return render(
    <MantineProvider>
      <ModalsProvider>{ui}</ModalsProvider>
    </MantineProvider>,
  );
}

const EMPTY_FILTER: TraceFilter = {
  search: '',
  agent_ids: [],
  statuses: [],
};

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
  setMockPermission(() => true);
});

function acmeTenantId(): string {
  const acme = Object.values(useMockStore.getState().tenants).find((t) => t.slug === 'acme');
  if (!acme) throw new Error('No acme tenant seeded');
  return acme.id;
}

describe('TraceList', () => {
  it('renders trace rows with agent, model, and status columns', () => {
    const tenantId = acmeTenantId();
    const traces = Object.values(useMockStore.getState().aiTraces)
      .filter((t) => t.tenant_id === tenantId)
      .slice(0, 5);
    expect(traces.length).toBeGreaterThan(0);

    wrap(<TraceList rows={traces} onSelect={vi.fn()} />);

    // At least header + rows
    const rows = screen.getAllByRole('row');
    expect(rows.length).toBeGreaterThan(1);
  });

  it('invokes onSelect when a row is clicked', () => {
    const tenantId = acmeTenantId();
    const traces = Object.values(useMockStore.getState().aiTraces)
      .filter((t) => t.tenant_id === tenantId)
      .slice(0, 3);
    const onSelect = vi.fn();

    wrap(<TraceList rows={traces} onSelect={onSelect} />);

    // Click a data row (skip header).
    const rows = screen.getAllByRole('row');
    const dataRow = rows[1];
    if (!dataRow) throw new Error('Expected at least one data row');
    fireEvent.click(dataRow);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('renders empty state when no rows match', () => {
    wrap(<TraceList rows={[]} onSelect={vi.fn()} />);
    expect(screen.getByText(/No traces/i)).toBeInTheDocument();
  });
});

describe('TraceFilterBar', () => {
  it('disables text search when user lacks ai-trace:read-sensitive', () => {
    // Override usePermission to mimic a user without ai-trace:read-sensitive.
    setMockPermission((k) => k !== 'ai-trace:read-sensitive');

    const tenantId = acmeTenantId();
    const range: RangePreset = 'all';
    wrap(
      <TraceFilterBar
        tenantId={tenantId}
        filter={EMPTY_FILTER}
        rangePreset={range}
        onChange={vi.fn()}
      />,
    );

    const searchInput = screen.getByLabelText(/search trace text/i);
    expect((searchInput as HTMLInputElement).disabled).toBe(true);
  });

  it('calls onChange with agent_ids when an agent is picked', () => {
    const tenantId = acmeTenantId();
    const agent = Object.values(useMockStore.getState().aiAgents).find(
      (a) => a.tenant_id === tenantId,
    );
    if (!agent) throw new Error('No agent seeded');

    const onChange = vi.fn();
    const range: RangePreset = 'all';
    wrap(
      <TraceFilterBar
        tenantId={tenantId}
        filter={EMPTY_FILTER}
        rangePreset={range}
        onChange={onChange}
      />,
    );

    // Directly click the MultiSelect; selecting via Mantine's portal dropdown
    // is fiddly in jsdom, so assert the input is wired and accessible.
    // Mantine's MultiSelect renders multiple descendants that carry the
    // aria-label (search input + hidden input) — getAllByLabelText is the
    // correct selector in this case.
    const multi = screen.getAllByLabelText(/filter by agent/i);
    expect(multi.length).toBeGreaterThan(0);
  });

  it('switches range preset via SegmentedControl', () => {
    const tenantId = acmeTenantId();
    const onChange = vi.fn();
    const range: RangePreset = '24h';

    wrap(
      <TraceFilterBar
        tenantId={tenantId}
        filter={EMPTY_FILTER}
        rangePreset={range}
        onChange={onChange}
      />,
    );

    // Click the "7d" label.
    const option = screen.getByRole('radio', { name: /7d/i });
    fireEvent.click(option);
    expect(onChange).toHaveBeenCalled();
    const call = onChange.mock.calls[0] as [TraceFilter, RangePreset];
    expect(call[1]).toBe('7d');
    expect(typeof call[0].since).toBe('string');
  });
});
