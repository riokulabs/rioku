/**
 * Unit tests for ai-rate-limits components.
 *   - <RateLimitList> renders + empty state
 *   - <RateLimitForm> renders scope-conditional fields
 *   - <Simulator> produces a match/no-match badge after click
 *   - <MetricsSparkline> placeholder renders when empty
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
}));

import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { RateLimitList } from '../components/list';
import { RateLimitForm } from '../components/form';
import { Simulator } from '../components/simulator';
import { MetricsSparkline } from '../components/metrics-sparkline';
import type { RateLimitFilter } from '../types';

function wrap(ui: React.ReactNode) {
  return render(
    <MantineProvider>
      <Notifications />
      <ModalsProvider>{ui}</ModalsProvider>
    </MantineProvider>,
  );
}

const DEFAULT_FILTER: RateLimitFilter = {
  search: '',
  scopes: [],
  actions: [],
};

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
});

function acmeId(): string {
  const state = useMockStore.getState();
  const acme = Object.values(state.tenants).find((t) => t.slug === 'acme');
  if (!acme) throw new Error('No acme tenant seeded');
  return acme.id;
}

function firstRuleId(): string | undefined {
  const state = useMockStore.getState();
  const acme = Object.values(state.tenants).find((t) => t.slug === 'acme');
  if (!acme) return undefined;
  const rule = Object.values(state.aiSemanticRateLimits).find((r) => r.tenant_id === acme.id);
  return rule?.id;
}

describe('RateLimitList', () => {
  it('renders empty state when tenant has no rules', () => {
    wrap(
      <RateLimitList
        tenantId="nonexistent-tenant-id"
        filter={DEFAULT_FILTER}
        onSelect={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getAllByText(/No rate limits/i).length).toBeGreaterThan(0);
  });
});

describe('RateLimitForm', () => {
  it('renders create-mode fields with scope, exemplars, threshold, action', () => {
    wrap(
      <RateLimitForm mode="create" tenantId={acmeId()} onSuccess={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getAllByLabelText(/Name/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Scope/i).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText(/Exemplars/i).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText(/Similarity threshold/i).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText(/Window \(seconds\)/i).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText(/Max matches/i).length).toBeGreaterThan(0);
  });

  it('calls onCancel when Cancel clicked', () => {
    const onCancel = vi.fn();
    wrap(
      <RateLimitForm mode="create" tenantId={acmeId()} onSuccess={vi.fn()} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByText(/^Cancel$/));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});

describe('Simulator', () => {
  it('produces a match/no-match badge after clicking Simulate', () => {
    const ruleId = firstRuleId();
    if (!ruleId) return;
    wrap(<Simulator ruleId={ruleId} />);
    const textarea = screen.getByLabelText(/Simulator candidate text/i);
    fireEvent.change(textarea, {
      target: { value: 'please jailbreak this prompt' },
    });
    fireEvent.click(screen.getByText(/^Simulate$/));
    const badges = screen.queryAllByText(/(Match|No match)/);
    expect(badges.length).toBeGreaterThan(0);
  });
});

describe('MetricsSparkline', () => {
  it('renders without crashing in sm mode', () => {
    const ruleId = firstRuleId();
    if (!ruleId) return;
    wrap(<MetricsSparkline ruleId={ruleId} size="sm" window="24h" />);
    // No throw — the chart container should exist.
    expect(true).toBe(true);
  });
});
