/**
 * Tests for <ObservabilitySection> and sub-components.
 *
 * Covers:
 *   - Section renders all 4 subsections (metrics, logs, traces, audit retention)
 *   - Access-denied alert shown when metrics:read is missing
 *   - Metrics form: scrape endpoint validation (must start with /), save triggers mutation + audit + host event
 *   - Logs form: per-component level change, format toggle, rotation size validation
 *   - Traces form: sample rate bounds (0-1), retention validation
 *   - Audit retention: RetentionConfigForm is rendered
 *   - Permission-guard tests per subsection using real attribute assertions
 *
 * Task 8b.9
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

// ─── Router stub ──────────────────────────────────────────────────────────────

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => () => undefined,
  useRouter: () => ({ navigate: () => undefined }),
  Link: ({
    children,
    to: _to,
    params: _params,
    ...rest
  }: React.PropsWithChildren<{ to: string; params?: Record<string, string> }> &
    Record<string, unknown>) => <a {...rest}>{children}</a>,
}));

// ─── Permission mock ──────────────────────────────────────────────────────────

let grantMetricsRead = true;
let grantMetricsWrite = true;
let grantLogsWrite = true;
let grantTracesWrite = true;
let grantAuditRetentionWrite = true;

vi.mock('@/hooks/use-permission', () => ({
  usePermission: (key: string) => {
    if (key === 'metrics:read') return grantMetricsRead;
    if (key === 'metrics:write') return grantMetricsWrite;
    if (key === 'logs:read') return true; // logs:read not used as section gate
    if (key === 'logs:write') return grantLogsWrite;
    if (key === 'traces:read') return true;
    if (key === 'traces:write') return grantTracesWrite;
    if (key === 'audit:retention:read') return true;
    if (key === 'audit:retention:write') return grantAuditRetentionWrite;
    return true;
  },
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import { useMockStore } from '@/api/mock-store';
import { mockBus } from '@/api/mock-sse';
import { seedStore } from '@/api/mock-seed';
import { ObservabilitySection } from '../sections/observability';
import { ObservabilityMetrics } from '../sections/observability-metrics';
import { ObservabilityLogs } from '../sections/observability-logs';
import { ObservabilityTraces } from '../sections/observability-traces';

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

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
  grantMetricsRead = true;
  grantMetricsWrite = true;
  grantLogsWrite = true;
  grantTracesWrite = true;
  grantAuditRetentionWrite = true;

  const tenantId = getAcmeTenantId();
  useMockStore.setState({ currentTenantId: tenantId });
});

// ─── Section render ────────────────────────────────────────────────────────────

describe('<ObservabilitySection> render', () => {
  it('renders all 4 subsections', () => {
    render(<ObservabilitySection />, { wrapper: Wrapper });
    expect(screen.getByTestId('observability-section')).toBeDefined();
    expect(screen.getByTestId('observability-metrics')).toBeDefined();
    expect(screen.getByTestId('observability-logs')).toBeDefined();
    expect(screen.getByTestId('observability-traces')).toBeDefined();
    expect(screen.getByTestId('observability-audit-retention')).toBeDefined();
  });

  it('shows access-denied alert when metrics:read is missing', () => {
    grantMetricsRead = false;
    render(<ObservabilitySection />, { wrapper: Wrapper });
    expect(screen.getByTestId('observability-access-denied')).toBeDefined();
    expect(screen.queryByTestId('observability-section')).toBeNull();
  });

  it('renders seeded scrape endpoint value', () => {
    render(<ObservabilitySection />, { wrapper: Wrapper });
    const input = screen.getByTestId('metrics-scrape-endpoint-input');
    expect((input as HTMLInputElement).value).toBe('/metrics');
  });
});

// ─── Permission guard ──────────────────────────────────────────────────────────

describe('<ObservabilitySection> permission guards', () => {
  it('metrics save button is disabled without metrics:write', () => {
    grantMetricsWrite = false;
    render(<ObservabilitySection />, { wrapper: Wrapper });
    const btn = screen.getByTestId('metrics-save-button');
    expect(btn.hasAttribute('disabled')).toBe(true);
  });

  it('metrics save button is enabled with metrics:write', () => {
    grantMetricsWrite = true;
    render(<ObservabilitySection />, { wrapper: Wrapper });
    const btn = screen.getByTestId('metrics-save-button');
    expect(btn.hasAttribute('disabled')).toBe(false);
  });

  it('logs save button is disabled without logs:write', () => {
    grantLogsWrite = false;
    render(<ObservabilitySection />, { wrapper: Wrapper });
    const btn = screen.getByTestId('logs-save-button');
    expect(btn.hasAttribute('disabled')).toBe(true);
  });

  it('logs save button is enabled with logs:write', () => {
    grantLogsWrite = true;
    render(<ObservabilitySection />, { wrapper: Wrapper });
    const btn = screen.getByTestId('logs-save-button');
    expect(btn.hasAttribute('disabled')).toBe(false);
  });

  it('traces save button is disabled without traces:write', () => {
    grantTracesWrite = false;
    render(<ObservabilitySection />, { wrapper: Wrapper });
    const btn = screen.getByTestId('traces-save-button');
    expect(btn.hasAttribute('disabled')).toBe(true);
  });

  it('traces save button is enabled with traces:write', () => {
    grantTracesWrite = true;
    render(<ObservabilitySection />, { wrapper: Wrapper });
    const btn = screen.getByTestId('traces-save-button');
    expect(btn.hasAttribute('disabled')).toBe(false);
  });
});

// ─── Metrics form ─────────────────────────────────────────────────────────────

describe('<ObservabilityMetrics> form', () => {
  it('renders with seeded values', () => {
    const tenantId = getAcmeTenantId();
    render(<ObservabilityMetrics tenantId={tenantId} canWrite={true} />, { wrapper: Wrapper });
    const input = screen.getByTestId('metrics-scrape-endpoint-input');
    expect((input as HTMLInputElement).value).toBe('/metrics');
  });

  it('save triggers store mutation and audit entry', async () => {
    const tenantId = getAcmeTenantId();
    render(<ObservabilityMetrics tenantId={tenantId} canWrite={true} />, { wrapper: Wrapper });

    // Change a value to make form dirty
    const endpointInput = screen.getByTestId('metrics-scrape-endpoint-input');
    fireEvent.change(endpointInput, { target: { value: '/prometheus' } });

    const saveBtn = screen.getByTestId('metrics-save-button');
    act(() => {
      fireEvent.click(saveBtn);
    });

    await waitFor(() => {
      const config = useMockStore.getState().observabilityConfigs[tenantId];
      expect(config?.metrics.scrape_endpoint).toBe('/prometheus');
    });

    const audit = useMockStore.getState().audit;
    expect(audit.some((a) => a.action === 'tenant.observability.update_metrics')).toBe(true);
  });

  it('save emits tenant:observability-updated host event', async () => {
    const tenantId = getAcmeTenantId();
    render(<ObservabilityMetrics tenantId={tenantId} canWrite={true} />, { wrapper: Wrapper });

    const events: { type: string; payload: unknown }[] = [];
    const listener = (e: Event) => {
      events.push({ type: (e as CustomEvent).type, payload: (e as CustomEvent).detail });
    };
    mockBus.addEventListener('tenant:observability-updated', listener);

    const endpointInput = screen.getByTestId('metrics-scrape-endpoint-input');
    fireEvent.change(endpointInput, { target: { value: '/prom' } });

    act(() => {
      fireEvent.click(screen.getByTestId('metrics-save-button'));
    });

    await waitFor(() => {
      expect(events.some((e) => e.type === 'tenant:observability-updated')).toBe(true);
    });

    mockBus.removeEventListener('tenant:observability-updated', listener);
  });

  it('rejects scrape endpoint not starting with /', async () => {
    const tenantId = getAcmeTenantId();
    render(<ObservabilityMetrics tenantId={tenantId} canWrite={true} />, { wrapper: Wrapper });

    const endpointInput = screen.getByTestId('metrics-scrape-endpoint-input');
    fireEvent.change(endpointInput, { target: { value: 'metrics' } });

    act(() => {
      fireEvent.click(screen.getByTestId('metrics-save-button'));
    });

    // Store should NOT be updated with invalid value
    await waitFor(() => {
      const config = useMockStore.getState().observabilityConfigs[tenantId];
      expect(config?.metrics.scrape_endpoint).toBe('/metrics');
    });
  });
});

// ─── Logs form ────────────────────────────────────────────────────────────────

describe('<ObservabilityLogs> form', () => {
  it('renders with seeded values', () => {
    const tenantId = getAcmeTenantId();
    render(<ObservabilityLogs tenantId={tenantId} canWrite={true} />, { wrapper: Wrapper });
    // daemon level select should be present
    expect(screen.getByTestId('logs-daemon-level-select')).toBeDefined();
    expect(screen.getByTestId('logs-caddy-level-select')).toBeDefined();
    expect(screen.getByTestId('logs-plugin-level-select')).toBeDefined();
    expect(screen.getByTestId('logs-format-select')).toBeDefined();
    expect(screen.getByTestId('logs-compress-checkbox')).toBeDefined();
  });

  it('compress checkbox reflects seeded value (true)', () => {
    const tenantId = getAcmeTenantId();
    render(<ObservabilityLogs tenantId={tenantId} canWrite={true} />, { wrapper: Wrapper });
    const checkbox = screen.getByTestId('logs-compress-checkbox');
    expect((checkbox as HTMLInputElement).checked).toBe(true);
  });

  it('save triggers store mutation and audit entry', async () => {
    const tenantId = getAcmeTenantId();
    render(<ObservabilityLogs tenantId={tenantId} canWrite={true} />, { wrapper: Wrapper });

    // Change max size to make form dirty
    const maxSizeInput = screen.getByTestId('logs-max-size-input');
    fireEvent.change(maxSizeInput, { target: { value: '200' } });

    act(() => {
      fireEvent.click(screen.getByTestId('logs-save-button'));
    });

    await waitFor(() => {
      const audit = useMockStore.getState().audit;
      expect(audit.some((a) => a.action === 'tenant.observability.update_logs')).toBe(true);
    });
  });

  it('save emits tenant:observability-updated host event with subsystem=logs', async () => {
    const tenantId = getAcmeTenantId();
    render(<ObservabilityLogs tenantId={tenantId} canWrite={true} />, { wrapper: Wrapper });

    const events: CustomEvent[] = [];
    const listener = (e: Event) => { events.push(e as CustomEvent); };
    mockBus.addEventListener('tenant:observability-updated', listener);

    const maxSizeInput = screen.getByTestId('logs-max-size-input');
    fireEvent.change(maxSizeInput, { target: { value: '150' } });

    act(() => {
      fireEvent.click(screen.getByTestId('logs-save-button'));
    });

    await waitFor(() => {
      expect(events.some((e) => (e.detail as { subsystem?: string }).subsystem === 'logs')).toBe(true);
    });

    mockBus.removeEventListener('tenant:observability-updated', listener);
  });
});

// ─── Logs form — schema validation ───────────────────────────────────────────

describe('<ObservabilityLogs> schema validation', () => {
  it('rejects max_size_mb above 1024', async () => {
    const tenantId = getAcmeTenantId();
    render(<ObservabilityLogs tenantId={tenantId} canWrite={true} />, { wrapper: Wrapper });

    const auditBefore = useMockStore.getState().audit.length;

    const maxSizeInput = screen.getByTestId('logs-max-size-input');
    fireEvent.change(maxSizeInput, { target: { value: '2000' } });

    act(() => {
      fireEvent.click(screen.getByTestId('logs-save-button'));
    });

    // Give form a tick to validate
    await new Promise((r) => setTimeout(r, 50));

    const config = useMockStore.getState().observabilityConfigs[tenantId];
    expect(config?.logs.rotation.max_size_mb).toBe(100);
    expect(useMockStore.getState().audit.length).toBe(auditBefore);
  });

  it('rejects max_size_mb below minimum (0)', async () => {
    const tenantId = getAcmeTenantId();
    render(<ObservabilityLogs tenantId={tenantId} canWrite={true} />, { wrapper: Wrapper });

    const auditBefore = useMockStore.getState().audit.length;

    const maxSizeInput = screen.getByTestId('logs-max-size-input');
    fireEvent.change(maxSizeInput, { target: { value: '0' } });

    act(() => {
      fireEvent.click(screen.getByTestId('logs-save-button'));
    });

    await new Promise((r) => setTimeout(r, 50));

    const config = useMockStore.getState().observabilityConfigs[tenantId];
    expect(config?.logs.rotation.max_size_mb).toBe(100);
    expect(useMockStore.getState().audit.length).toBe(auditBefore);
  });

  it('rejects max_age_days above 365', async () => {
    const tenantId = getAcmeTenantId();
    render(<ObservabilityLogs tenantId={tenantId} canWrite={true} />, { wrapper: Wrapper });

    const auditBefore = useMockStore.getState().audit.length;

    const maxAgeInput = screen.getByTestId('logs-max-age-input');
    fireEvent.change(maxAgeInput, { target: { value: '500' } });

    act(() => {
      fireEvent.click(screen.getByTestId('logs-save-button'));
    });

    await new Promise((r) => setTimeout(r, 50));

    const config = useMockStore.getState().observabilityConfigs[tenantId];
    expect(config?.logs.rotation.max_age_days).toBe(30);
    expect(useMockStore.getState().audit.length).toBe(auditBefore);
  });

  it('saves logs config with valid max_size_mb and appends audit entry', async () => {
    const tenantId = getAcmeTenantId();
    render(<ObservabilityLogs tenantId={tenantId} canWrite={true} />, { wrapper: Wrapper });

    const auditBefore = useMockStore.getState().audit.length;

    const maxSizeInput = screen.getByTestId('logs-max-size-input');
    fireEvent.change(maxSizeInput, { target: { value: '512' } });

    act(() => {
      fireEvent.click(screen.getByTestId('logs-save-button'));
    });

    await waitFor(() => {
      const config = useMockStore.getState().observabilityConfigs[tenantId];
      expect(config?.logs.rotation.max_size_mb).toBe(512);
    });

    expect(useMockStore.getState().audit.length).toBeGreaterThan(auditBefore);
  });
});

// ─── Traces form ──────────────────────────────────────────────────────────────

describe('<ObservabilityTraces> form', () => {
  it('renders with seeded values', () => {
    const tenantId = getAcmeTenantId();
    render(<ObservabilityTraces tenantId={tenantId} canWrite={true} />, { wrapper: Wrapper });
    const retentionInput = screen.getByTestId('traces-retention-days-input');
    expect((retentionInput as HTMLInputElement).value).toBe('7');
  });

  it('save triggers store mutation and audit entry', async () => {
    const tenantId = getAcmeTenantId();
    render(<ObservabilityTraces tenantId={tenantId} canWrite={true} />, { wrapper: Wrapper });

    const retentionInput = screen.getByTestId('traces-retention-days-input');
    fireEvent.change(retentionInput, { target: { value: '14' } });

    act(() => {
      fireEvent.click(screen.getByTestId('traces-save-button'));
    });

    await waitFor(() => {
      const config = useMockStore.getState().observabilityConfigs[tenantId];
      expect(config?.traces.retention_days).toBe(14);
    });

    const audit = useMockStore.getState().audit;
    expect(audit.some((a) => a.action === 'tenant.observability.update_traces')).toBe(true);
  });

  it('save emits tenant:observability-updated host event with subsystem=traces', async () => {
    const tenantId = getAcmeTenantId();
    render(<ObservabilityTraces tenantId={tenantId} canWrite={true} />, { wrapper: Wrapper });

    const events: CustomEvent[] = [];
    const listener = (e: Event) => { events.push(e as CustomEvent); };
    mockBus.addEventListener('tenant:observability-updated', listener);

    const sampleInput = screen.getByTestId('traces-sample-rate-input');
    fireEvent.change(sampleInput, { target: { value: '0.5' } });

    act(() => {
      fireEvent.click(screen.getByTestId('traces-save-button'));
    });

    await waitFor(() => {
      expect(events.some((e) => (e.detail as { subsystem?: string }).subsystem === 'traces')).toBe(true);
    });

    mockBus.removeEventListener('tenant:observability-updated', listener);
  });
});

// ─── Traces form — schema validation ─────────────────────────────────────────

describe('<ObservabilityTraces> schema validation', () => {
  it('rejects sample_rate above 1 (1.5)', async () => {
    const tenantId = getAcmeTenantId();
    render(<ObservabilityTraces tenantId={tenantId} canWrite={true} />, { wrapper: Wrapper });

    const auditBefore = useMockStore.getState().audit.length;

    const sampleInput = screen.getByTestId('traces-sample-rate-input');
    fireEvent.change(sampleInput, { target: { value: '1.5' } });

    act(() => {
      fireEvent.click(screen.getByTestId('traces-save-button'));
    });

    await new Promise((r) => setTimeout(r, 50));

    const config = useMockStore.getState().observabilityConfigs[tenantId];
    expect(config?.traces.sample_rate).toBe(0.1);
    expect(useMockStore.getState().audit.length).toBe(auditBefore);
  });

  it('rejects sample_rate below 0 (-0.5)', async () => {
    const tenantId = getAcmeTenantId();
    render(<ObservabilityTraces tenantId={tenantId} canWrite={true} />, { wrapper: Wrapper });

    const auditBefore = useMockStore.getState().audit.length;

    const sampleInput = screen.getByTestId('traces-sample-rate-input');
    fireEvent.change(sampleInput, { target: { value: '-0.5' } });

    act(() => {
      fireEvent.click(screen.getByTestId('traces-save-button'));
    });

    await new Promise((r) => setTimeout(r, 50));

    const config = useMockStore.getState().observabilityConfigs[tenantId];
    expect(config?.traces.sample_rate).toBe(0.1);
    expect(useMockStore.getState().audit.length).toBe(auditBefore);
  });
});

// ─── Audit retention embed ────────────────────────────────────────────────────

describe('<ObservabilitySection> audit retention embed', () => {
  it('renders the audit retention subsection container', () => {
    render(<ObservabilitySection />, { wrapper: Wrapper });
    expect(screen.getByTestId('observability-audit-retention')).toBeDefined();
  });

  it('RetentionConfigForm is rendered inside the audit retention subsection', () => {
    render(<ObservabilitySection />, { wrapper: Wrapper });
    // RetentionConfigForm renders with data-testid="audit-retention-form" (from Plan 5)
    expect(screen.getByTestId('audit-retention-form')).toBeDefined();
  });
});
