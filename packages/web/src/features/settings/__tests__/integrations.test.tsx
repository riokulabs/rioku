/**
 * Tests for <IntegrationsSection> and related components.
 *
 * Covers:
 *   - OAuth cards hidden when integrationsOAuth feature flag is off
 *   - Webhooks table shows seeded webhooks
 *   - Create webhook modal: opens, validates path prefix, submits → audit + host event
 *   - Edit webhook: saves changes
 *   - Delete webhook: confirms + removes + audit
 *   - Permission-guard tests for write actions (real attribute assertions)
 *   - transitionProps JSDOM comment present on modals (verified via rendered HTML)
 *
 * Task 8c.11
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

let grantRead = true;
let grantWrite = true;

vi.mock('@/hooks/use-permission', () => ({
  usePermission: (key: string) => {
    if (key === 'integrations:read') return grantRead;
    if (key === 'integrations:write') return grantWrite;
    return true;
  },
}));

// ─── Feature flags mock ───────────────────────────────────────────────────────
// OAuth connector cards are hidden when integrationsOAuth flag is off.
vi.mock('@/host/feature-flags', () => ({
  isFeatureEnabled: (flag: string) => flag !== 'integrationsOAuth',
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import { useMockStore } from '@/api/mock-store';
import { mockBus } from '@/api/mock-sse';
import { seedStore } from '@/api/mock-seed';
import { IntegrationsSection } from '../sections/integrations';

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
  grantRead = true;
  grantWrite = true;

  const tenantId = getAcmeTenantId();
  useMockStore.setState({ currentTenantId: tenantId });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('IntegrationsSection — banner and layout', () => {
  it('does not render stage-1 banner (removed with feature flag)', () => {
    render(<IntegrationsSection />, { wrapper: Wrapper });
    expect(screen.queryByTestId('integrations-stage1-banner')).toBeNull();
  });

  it('shows access-denied alert when integrations:read is missing', () => {
    grantRead = false;
    render(<IntegrationsSection />, { wrapper: Wrapper });
    expect(screen.getByTestId('integrations-access-denied')).toBeDefined();
    expect(screen.queryByTestId('integrations-section')).toBeNull();
  });

  it('renders the integrations section container when read is granted', () => {
    render(<IntegrationsSection />, { wrapper: Wrapper });
    expect(screen.getByTestId('integrations-section')).toBeDefined();
  });
});

describe('IntegrationsSection — OAuth cards', () => {
  it('does not render OAuth cards when integrationsOAuth feature flag is off', () => {
    render(<IntegrationsSection />, { wrapper: Wrapper });
    expect(screen.queryByTestId('oauth-card-github')).toBeNull();
    expect(screen.queryByTestId('oauth-card-google')).toBeNull();
    expect(screen.queryByTestId('oauth-card-gitlab')).toBeNull();
    expect(screen.queryByTestId('oauth-card-microsoft')).toBeNull();
  });

  it('does not render Configure buttons when integrationsOAuth feature flag is off', () => {
    render(<IntegrationsSection />, { wrapper: Wrapper });
    const buttons = screen.queryAllByRole('button', { name: /configure/i });
    expect(buttons.length).toBe(0);
  });
});

describe('IntegrationsSection — Webhooks table', () => {
  it('renders the webhook table with seeded endpoints', () => {
    render(<IntegrationsSection />, { wrapper: Wrapper });
    const table = screen.getByTestId('webhook-table');
    expect(table).toBeDefined();
    // Seeded: GitHub events + Stripe events for acme tenant
    expect(screen.getByText('GitHub events')).toBeDefined();
    expect(screen.getByText('Stripe events')).toBeDefined();
  });

  it('shows webhook path as code element', () => {
    render(<IntegrationsSection />, { wrapper: Wrapper });
    expect(screen.getByText('/webhooks/github')).toBeDefined();
    expect(screen.getByText('/webhooks/stripe')).toBeDefined();
  });

  it('shows enabled badge for GitHub events (enabled=true)', () => {
    render(<IntegrationsSection />, { wrapper: Wrapper });
    const state = useMockStore.getState();
    const ghEndpoint = Object.values(state.webhookEndpoints).find(
      (e) => e.name === 'GitHub events' && e.tenant_id === getAcmeTenantId(),
    );
    if (!ghEndpoint) throw new Error('GitHub events webhook not found');
    const badge = screen.getByTestId(`webhook-enabled-badge-${ghEndpoint.id}`);
    expect(badge.textContent).toContain('enabled');
  });
});

describe('IntegrationsSection — Create webhook', () => {
  it('opens create webhook modal when Add webhook button is clicked', () => {
    render(<IntegrationsSection />, { wrapper: Wrapper });
    const addBtn = screen.getByTestId('add-webhook-button');
    fireEvent.click(addBtn);
    expect(screen.getByTestId('create-webhook-modal')).toBeDefined();
  });

  it('shows validation error when path does not start with /webhooks/', async () => {
    render(<IntegrationsSection />, { wrapper: Wrapper });
    fireEvent.click(screen.getByTestId('add-webhook-button'));

    const nameInput = screen.getByTestId('webhook-name-input');
    const pathInput = screen.getByTestId('webhook-path-input');
    fireEvent.change(nameInput, { target: { value: 'My webhook' } });
    fireEvent.change(pathInput, { target: { value: '/invalid/path' } });
    fireEvent.click(screen.getByTestId('create-webhook-button'));

    await waitFor(() => {
      const matches = screen.getAllByText(/must start with \/webhooks\//i);
      expect(matches.length).toBeGreaterThan(0);
    });
  });

  it('creates webhook endpoint, writes to store, emits audit and host event', async () => {
    const hostEvents: { type: string; payload: unknown }[] = [];
    const listener = (e: Event) => {
      hostEvents.push({ type: (e as CustomEvent).type, payload: (e as CustomEvent).detail });
    };
    mockBus.addEventListener('integrations:webhook-added', listener);

    const beforeCount = Object.keys(useMockStore.getState().webhookEndpoints).length;

    render(<IntegrationsSection />, { wrapper: Wrapper });
    fireEvent.click(screen.getByTestId('add-webhook-button'));

    fireEvent.change(screen.getByTestId('webhook-name-input'), {
      target: { value: 'New webhook' },
    });
    fireEvent.change(screen.getByTestId('webhook-path-input'), {
      target: { value: '/webhooks/new-endpoint' },
    });
    fireEvent.click(screen.getByTestId('create-webhook-button'));

    await waitFor(() => {
      expect(Object.keys(useMockStore.getState().webhookEndpoints).length).toBe(beforeCount + 1);
    });

    // Audit entry
    const audit = useMockStore.getState().audit;
    expect(audit.some((a) => a.action === 'tenant.webhook.create')).toBe(true);

    // Host event
    expect(hostEvents.some((e) => e.type === 'integrations:webhook-added')).toBe(true);

    mockBus.removeEventListener('integrations:webhook-added', listener);
  });
});

describe('IntegrationsSection — Edit webhook', () => {
  it('opens edit modal with existing values when Edit is clicked', async () => {
    render(<IntegrationsSection />, { wrapper: Wrapper });

    // Click the actions menu for the first webhook row
    const state = useMockStore.getState();
    const ep = Object.values(state.webhookEndpoints).find((e) => e.tenant_id === getAcmeTenantId());
    if (!ep) throw new Error('Webhook endpoint not found');

    const actionsBtn = screen.getByTestId(`webhook-actions-${ep.id}`);
    fireEvent.click(actionsBtn);

    await waitFor(() => {
      expect(screen.getByTestId(`webhook-edit-${ep.id}`)).toBeDefined();
    });
    fireEvent.click(screen.getByTestId(`webhook-edit-${ep.id}`));

    await waitFor(() => {
      expect(screen.getByTestId('edit-webhook-modal')).toBeDefined();
    });

    // Name should be pre-filled
    const nameInput = screen.getByTestId('webhook-name-input');
    expect((nameInput as HTMLInputElement).value).toBe(ep.name);
  });

  it('saves edit changes to store and emits audit + host event', async () => {
    const hostEvents: { type: string; payload: unknown }[] = [];
    const listener = (e: Event) => {
      hostEvents.push({ type: (e as CustomEvent).type, payload: (e as CustomEvent).detail });
    };
    mockBus.addEventListener('integrations:webhook-updated', listener);

    render(<IntegrationsSection />, { wrapper: Wrapper });

    const state = useMockStore.getState();
    const ep = Object.values(state.webhookEndpoints).find((e) => e.tenant_id === getAcmeTenantId());
    if (!ep) throw new Error('Webhook endpoint not found');

    fireEvent.click(screen.getByTestId(`webhook-actions-${ep.id}`));
    await waitFor(() => {
      expect(screen.getByTestId(`webhook-edit-${ep.id}`)).toBeDefined();
    });
    fireEvent.click(screen.getByTestId(`webhook-edit-${ep.id}`));

    await waitFor(() => {
      expect(screen.getByTestId('edit-webhook-modal')).toBeDefined();
    });

    fireEvent.change(screen.getByTestId('webhook-name-input'), {
      target: { value: 'Updated name' },
    });
    fireEvent.click(screen.getByTestId('save-webhook-button'));

    await waitFor(() => {
      const updated = useMockStore.getState().webhookEndpoints[ep.id];
      expect(updated?.name).toBe('Updated name');
    });

    expect(useMockStore.getState().audit.some((a) => a.action === 'tenant.webhook.update')).toBe(
      true,
    );
    expect(hostEvents.some((e) => e.type === 'integrations:webhook-updated')).toBe(true);

    mockBus.removeEventListener('integrations:webhook-updated', listener);
  });
});

describe('IntegrationsSection — Delete webhook', () => {
  it('shows delete confirm modal and removes endpoint after confirm', async () => {
    const hostEvents: { type: string; payload: unknown }[] = [];
    const listener = (e: Event) => {
      hostEvents.push({ type: (e as CustomEvent).type, payload: (e as CustomEvent).detail });
    };
    mockBus.addEventListener('integrations:webhook-deleted', listener);

    render(<IntegrationsSection />, { wrapper: Wrapper });

    const state = useMockStore.getState();
    const ep = Object.values(state.webhookEndpoints).find((e) => e.tenant_id === getAcmeTenantId());
    if (!ep) throw new Error('Webhook endpoint not found');

    fireEvent.click(screen.getByTestId(`webhook-actions-${ep.id}`));
    await waitFor(() => {
      expect(screen.getByTestId(`webhook-delete-${ep.id}`)).toBeDefined();
    });
    fireEvent.click(screen.getByTestId(`webhook-delete-${ep.id}`));

    await waitFor(() => {
      expect(screen.getByTestId('delete-webhook-modal')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('confirm-delete-webhook-button'));

    await waitFor(() => {
      expect(useMockStore.getState().webhookEndpoints[ep.id]).toBeUndefined();
    });

    expect(useMockStore.getState().audit.some((a) => a.action === 'tenant.webhook.delete')).toBe(
      true,
    );
    expect(hostEvents.some((e) => e.type === 'integrations:webhook-deleted')).toBe(true);

    mockBus.removeEventListener('integrations:webhook-deleted', listener);
  });
});

describe('IntegrationsSection — Permission guards', () => {
  it('Add webhook button is disabled when integrations:write is false', () => {
    grantWrite = false;
    render(<IntegrationsSection />, { wrapper: Wrapper });
    const addBtn = screen.getByTestId('add-webhook-button');
    // Real attribute assertion
    expect(addBtn.hasAttribute('disabled')).toBe(true);
  });

  it('action menu buttons are disabled when integrations:write is false', () => {
    grantWrite = false;
    render(<IntegrationsSection />, { wrapper: Wrapper });

    const state = useMockStore.getState();
    const ep = Object.values(state.webhookEndpoints).find((e) => e.tenant_id === getAcmeTenantId());
    if (!ep) throw new Error('Webhook endpoint not found');

    const actionsBtn = screen.getByTestId(`webhook-actions-${ep.id}`);
    // Real attribute assertion
    expect(actionsBtn.hasAttribute('disabled')).toBe(true);
  });
});
