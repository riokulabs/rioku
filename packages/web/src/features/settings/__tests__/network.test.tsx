/**
 * Tests for <NetworkSection>.
 *
 * Covers:
 *   - All 4 fieldsets render
 *   - Listen addresses shown as read-only (Badges, not inputs)
 *   - HTTP/3 Switch reflects initial value from store
 *   - Upstream timeout NumberInputs reflect initial values
 *   - Save button disabled without `network:write`
 *   - Save button disabled when form is not dirty
 *   - Save triggers store mutation + audit entry + tenant:network-config-updated host event
 *   - Invalid JSON in Caddy overrides shows error Alert
 *
 * Task 8b.6
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

// ─── Monaco mock ─────────────────────────────────────────────────────────────
// Must mock @monaco-editor/react before importing any component that lazily
// loads it, so the Suspense boundary resolves synchronously in tests.

vi.mock('@monaco-editor/react', () => {
  const MockEditor = ({
    value,
    onChange,
    options,
  }: {
    value?: string;
    onChange?: (v: string | undefined) => void;
    options?: { readOnly?: boolean };
  }) => (
    <textarea
      data-testid="monaco-stub"
      aria-label="caddy-config-editor"
      value={value ?? ''}
      readOnly={options?.readOnly ?? false}
      onChange={(e) => onChange?.(e.target.value)}
    />
  );
  return { default: MockEditor };
});

// ─── Router stub ─────────────────────────────────────────────────────────────

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

// ─── Permission mock ─────────────────────────────────────────────────────────

let grantWrite = true;
vi.mock('@/hooks/use-permission', () => ({
  usePermission: (key: string) => (key === 'network:write' ? grantWrite : true),
}));

// ─── Imports ─────────────────────────────────────────────────────────────────

import { useMockStore } from '@/api/mock-store';
import { mockBus } from '@/api/mock-sse';
import { seedStore } from '@/api/mock-seed';
import { NetworkSection } from '../sections/network';

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
  grantWrite = true;

  const tenantId = getAcmeTenantId();
  useMockStore.setState({ currentTenantId: tenantId });
});

// ─── Section render ───────────────────────────────────────────────────────────

describe('NetworkSection render', () => {
  it('renders all 4 fieldsets', () => {
    render(<NetworkSection />, { wrapper: Wrapper });
    expect(screen.getByTestId('fieldset-listen-addresses')).toBeDefined();
    expect(screen.getByTestId('fieldset-caddy-config')).toBeDefined();
    expect(screen.getByTestId('fieldset-http3')).toBeDefined();
    expect(screen.getByTestId('fieldset-upstream-timeouts')).toBeDefined();
  });

  it('shows listen addresses as Badges (not text inputs)', () => {
    render(<NetworkSection />, { wrapper: Wrapper });
    // :443 and :80 are rendered as Badges — they should NOT be inputs
    const fieldset = screen.getByTestId('fieldset-listen-addresses');
    const inputs = fieldset.querySelectorAll('input');
    expect(inputs.length).toBe(0);
    // Badges are rendered as spans/divs with the address text
    expect(fieldset.textContent).toContain(':443');
    expect(fieldset.textContent).toContain(':80');
  });

  it('HTTP/3 Switch reflects initial value from store', () => {
    render(<NetworkSection />, { wrapper: Wrapper });
    // Mantine Switch applies data-testid to the inner <input type="checkbox">.
    const switchInput = screen.getByTestId<HTMLInputElement>('http3-switch');
    // Seeded value is http3_enabled: true
    expect(switchInput.checked).toBe(true);
  });

  it('upstream timeout NumberInputs reflect initial values from store', () => {
    render(<NetworkSection />, { wrapper: Wrapper });
    // Mantine NumberInput applies data-testid to the inner <input> element.
    const connectInput = screen.getByTestId<HTMLInputElement>('timeout-connect');
    const readInput = screen.getByTestId<HTMLInputElement>('timeout-read');
    const writeInput = screen.getByTestId<HTMLInputElement>('timeout-write');
    const idleInput = screen.getByTestId<HTMLInputElement>('timeout-idle');

    // Seeded: connect=10, read=60, write=60, idle=120
    expect(connectInput.value).toBe('10');
    expect(readInput.value).toBe('60');
    expect(writeInput.value).toBe('60');
    expect(idleInput.value).toBe('120');
  });
});

// ─── Permission guard ──────────────────────────────────────────────────────────

describe('NetworkSection permission guard', () => {
  it('Save button is disabled without network:write', () => {
    grantWrite = false;
    render(<NetworkSection />, { wrapper: Wrapper });
    const saveBtn = screen.getByTestId('save-button');
    expect(saveBtn.hasAttribute('disabled')).toBe(true);
  });

  it('Save button is disabled when form is not dirty', () => {
    render(<NetworkSection />, { wrapper: Wrapper });
    const saveBtn = screen.getByTestId('save-button');
    expect(saveBtn.hasAttribute('disabled')).toBe(true);
  });
});

// ─── Save flow ────────────────────────────────────────────────────────────────

describe('NetworkSection save', () => {
  it('Save triggers store mutation + audit entry + tenant:network-config-updated host event', async () => {
    const hostEvents: string[] = [];
    const listener = (e: Event) => {
      hostEvents.push((e as CustomEvent).type);
    };
    mockBus.addEventListener('tenant:network-config-updated', listener);

    render(<NetworkSection />, { wrapper: Wrapper });

    // Dirty the form by toggling HTTP/3
    // Mantine Switch applies data-testid to the inner <input type="checkbox">.
    const switchInput = screen.getByTestId<HTMLInputElement>('http3-switch');
    fireEvent.click(switchInput);

    const saveBtn = screen.getByTestId('save-button');
    expect(saveBtn.hasAttribute('disabled')).toBe(false);

    fireEvent.click(saveBtn);

    const tenantId = getAcmeTenantId();

    await waitFor(() => {
      const config = useMockStore.getState().networkConfigs[tenantId];
      expect(config?.http3_enabled).toBe(false);
    });

    // Audit entry
    const audit = useMockStore.getState().audit;
    const entry = audit.find((a) => a.action === 'tenant.update_network_config');
    expect(entry).toBeDefined();
    expect(entry?.tenant_id).toBe(tenantId);

    // Host event
    expect(hostEvents.filter((t) => t === 'tenant:network-config-updated').length).toBe(1);

    mockBus.removeEventListener('tenant:network-config-updated', listener);
  });
});

// ─── JSON validation ──────────────────────────────────────────────────────────

describe('NetworkSection JSON validation', () => {
  it('shows error Alert when Caddy overrides contain invalid JSON on blur', async () => {
    render(<NetworkSection />, { wrapper: Wrapper });

    const monacoStub = screen.getByTestId('monaco-stub');

    // Change the value to invalid JSON
    fireEvent.change(monacoStub, { target: { value: '{ invalid json' } });

    // Trigger blur on the wrapper div
    const wrapper = screen.getByTestId('caddy-editor-wrapper');
    fireEvent.blur(wrapper);

    await waitFor(() => {
      expect(screen.getByTestId('json-error-alert')).toBeDefined();
    });
  });

  it('does not show error Alert when Caddy overrides contain valid JSON', async () => {
    render(<NetworkSection />, { wrapper: Wrapper });

    const monacoStub = screen.getByTestId('monaco-stub');

    // Change to valid JSON
    fireEvent.change(monacoStub, { target: { value: '{"key": "value"}' } });

    const wrapper = screen.getByTestId('caddy-editor-wrapper');
    fireEvent.blur(wrapper);

    // No error alert should be present
    await act(async () => {});
    expect(screen.queryByTestId('json-error-alert')).toBeNull();
  });
});

// ─── Post-save button state ───────────────────────────────────────────────────

describe('NetworkSection post-save button state', () => {
  it('Save button returns to disabled after save (resetDirty baseline)', async () => {
    render(<NetworkSection />, { wrapper: Wrapper });

    // Initially disabled — form not dirty
    expect(screen.getByTestId('save-button').hasAttribute('disabled')).toBe(true);

    // Make dirty by toggling HTTP/3
    const switchInput = screen.getByTestId<HTMLInputElement>('http3-switch');
    fireEvent.click(switchInput);

    // Should now be enabled
    expect(screen.getByTestId('save-button').hasAttribute('disabled')).toBe(false);

    // Save
    fireEvent.click(screen.getByTestId('save-button'));

    // After save completes, button should return to disabled (resetDirty baseline updated)
    await waitFor(() => {
      expect(screen.getByTestId('save-button').hasAttribute('disabled')).toBe(true);
    });
  });
});

// ─── API integration (updateNetworkConfig) ───────────────────────────────────
// Extended tests are in api.test.ts; these are light integration checks.

describe('updateNetworkConfig direct (via save)', () => {
  it('store config is mutated after save', async () => {
    render(<NetworkSection />, { wrapper: Wrapper });

    const switchInput = screen.getByTestId<HTMLInputElement>('http3-switch');
    fireEvent.click(switchInput);

    fireEvent.click(screen.getByTestId('save-button'));

    await waitFor(() => {
      const config = useMockStore.getState().networkConfigs[getAcmeTenantId()];
      expect(config?.http3_enabled).toBe(false);
    });
  });
});
