/**
 * Tests for <NotificationsSection> and updateTenantNotificationConfig API.
 *
 * Covers:
 *   - Section renders with all sub-regions
 *   - Form reflects initial values from seed store
 *   - Summary cards show channel / routing rule / delivery counts
 *   - Save button disabled without notification:admin
 *   - Save button hidden when form is not dirty
 *   - Save triggers store mutation + audit + tenant:notification-config-updated event
 *   - updateTenantNotificationConfig unit test (store mutation + audit + host event)
 *   - form.resetDirty called after save (Save button hidden after save)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

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

let grantAdmin = true;
vi.mock('@/hooks/use-permission', () => ({
  usePermission: (key: string) =>
    key === 'notification:admin' ? grantAdmin : true,
}));

// ─── Imports ─────────────────────────────────────────────────────────────────

import { useMockStore } from '@/api/mock-store';
import { mockBus } from '@/api/mock-sse';
import { seedStore } from '@/api/mock-seed';
import { NotificationsSection } from '../sections/notifications';
import { updateTenantNotificationConfig } from '../api';

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
  grantAdmin = true;

  const tenantId = getAcmeTenantId();
  useMockStore.setState({ currentTenantId: tenantId });
});

// ─── Section render ───────────────────────────────────────────────────────────

describe('NotificationsSection render', () => {
  it('renders the section container', () => {
    render(<NotificationsSection />, { wrapper: Wrapper });
    expect(screen.getByTestId('notifications-section')).toBeDefined();
  });

  it('renders the config form', () => {
    render(<NotificationsSection />, { wrapper: Wrapper });
    expect(screen.getByTestId('notifications-config-form')).toBeDefined();
  });

  it('renders the delivery summary cards', () => {
    render(<NotificationsSection />, { wrapper: Wrapper });
    expect(screen.getByTestId('notifications-delivery-summary')).toBeDefined();
  });

  it('renders the sub-page link cards', () => {
    render(<NotificationsSection />, { wrapper: Wrapper });
    expect(screen.getByTestId('notifications-subpage-cards')).toBeDefined();
    expect(screen.getByTestId('notifications-link-channels')).toBeDefined();
    expect(screen.getByTestId('notifications-link-routing')).toBeDefined();
    expect(screen.getByTestId('notifications-link-log')).toBeDefined();
  });

  it('shows notifications-enabled-switch reflecting seed value (true)', () => {
    render(<NotificationsSection />, { wrapper: Wrapper });
    const switchInput = screen.getByTestId<HTMLInputElement>('notifications-enabled-switch');
    expect(switchInput.checked).toBe(true);
  });

  it('shows channel count from store', () => {
    render(<NotificationsSection />, { wrapper: Wrapper });
    const el = screen.getByTestId('notifications-summary-channel-count');
    // Seed populates 6 channels for acme tenant
    const val = parseInt(el.textContent || '0', 10);
    expect(val).toBeGreaterThan(0);
  });

  it('shows routing rule count from store', () => {
    render(<NotificationsSection />, { wrapper: Wrapper });
    const el = screen.getByTestId('notifications-summary-routing-count');
    const val = parseInt(el.textContent || '0', 10);
    expect(val).toBeGreaterThan(0);
  });

  it('shows total deliveries from store', () => {
    render(<NotificationsSection />, { wrapper: Wrapper });
    const el = screen.getByTestId('notifications-summary-total');
    const val = parseInt(el.textContent || '0', 10);
    expect(val).toBeGreaterThan(0);
  });
});

// ─── Permission guard ─────────────────────────────────────────────────────────

describe('NotificationsSection permission guard', () => {
  it('Save button is absent when form is not dirty', () => {
    render(<NotificationsSection />, { wrapper: Wrapper });
    expect(screen.queryByTestId('notifications-save-btn')).toBeNull();
  });

  it('Save button is disabled without notification:admin', () => {
    grantAdmin = false;
    render(<NotificationsSection />, { wrapper: Wrapper });

    // Dirty the form by clicking the switch
    const switchInput = screen.getByTestId<HTMLInputElement>('notifications-enabled-switch');
    fireEvent.click(switchInput);

    const saveBtn = screen.getByTestId<HTMLButtonElement>('notifications-save-btn');
    expect(saveBtn.hasAttribute('disabled')).toBe(true);
  });

  it('Save button is enabled with notification:admin and dirty form', () => {
    render(<NotificationsSection />, { wrapper: Wrapper });

    const switchInput = screen.getByTestId<HTMLInputElement>('notifications-enabled-switch');
    fireEvent.click(switchInput);

    const saveBtn = screen.getByTestId<HTMLButtonElement>('notifications-save-btn');
    expect(saveBtn.hasAttribute('disabled')).toBe(false);
  });
});

// ─── Save flow ────────────────────────────────────────────────────────────────

describe('NotificationsSection save', () => {
  it('Save triggers store mutation + audit entry + host event', async () => {
    const hostEvents: string[] = [];
    const listener = (e: Event) => { hostEvents.push((e as CustomEvent).type); };
    mockBus.addEventListener('tenant:notification-config-updated', listener);

    render(<NotificationsSection />, { wrapper: Wrapper });

    // Dirty the form by toggling the master switch
    const switchInput = screen.getByTestId<HTMLInputElement>('notifications-enabled-switch');
    fireEvent.click(switchInput);

    const saveBtn = screen.getByTestId('notifications-save-btn');
    fireEvent.click(saveBtn);

    const tenantId = getAcmeTenantId();

    await waitFor(() => {
      const config = useMockStore.getState().notificationConfigs[tenantId];
      expect(config?.enabled).toBe(false);
    });

    // Audit entry
    const audit = useMockStore.getState().audit;
    const entry = audit.find((a) => a.action === 'tenant.notification_config.update');
    expect(entry).toBeDefined();
    expect(entry?.tenant_id).toBe(tenantId);

    // Host event
    expect(hostEvents.filter((t) => t === 'tenant:notification-config-updated').length).toBe(1);

    mockBus.removeEventListener('tenant:notification-config-updated', listener);
  });

  it('Save button is hidden after successful save (form reset dirty)', async () => {
    render(<NotificationsSection />, { wrapper: Wrapper });

    // Dirty the form
    const switchInput = screen.getByTestId<HTMLInputElement>('notifications-enabled-switch');
    fireEvent.click(switchInput);

    const saveBtn = screen.getByTestId('notifications-save-btn');
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(screen.queryByTestId('notifications-save-btn')).toBeNull();
    });
  });
});

// ─── API unit test ────────────────────────────────────────────────────────────

describe('updateTenantNotificationConfig', () => {
  it('updates store + appends audit + emits host event', async () => {
    const tenantId = getAcmeTenantId();

    const hostEvents: string[] = [];
    const listener = (e: Event) => { hostEvents.push((e as CustomEvent).type); };
    mockBus.addEventListener('tenant:notification-config-updated', listener);

    await act(async () => {
      await updateTenantNotificationConfig(tenantId, {
        enabled: false,
        opt_in_mode: 'opt-in',
        plugins_can_register_categories: false,
        max_retries: 5,
        retry_backoff_seconds: 60,
      });
    });

    const config = useMockStore.getState().notificationConfigs[tenantId];
    expect(config?.enabled).toBe(false);
    expect(config?.opt_in_mode).toBe('opt-in');
    expect(config?.plugins_can_register_categories).toBe(false);
    expect(config?.max_retries).toBe(5);
    expect(config?.retry_backoff_seconds).toBe(60);

    const audit = useMockStore.getState().audit;
    const entry = audit.find((a) => a.action === 'tenant.notification_config.update');
    expect(entry).toBeDefined();
    expect(entry?.tenant_id).toBe(tenantId);
    expect(entry?.tier).toBe('write');

    expect(hostEvents.includes('tenant:notification-config-updated')).toBe(true);

    mockBus.removeEventListener('tenant:notification-config-updated', listener);
  });

  it('no-ops for the store update if tenant has no notification config', async () => {
    // Use a bogus tenant ID that has no config
    await act(async () => {
      await updateTenantNotificationConfig('nonexistent-tenant-id', {
        enabled: false,
        opt_in_mode: 'opt-in',
        plugins_can_register_categories: false,
        max_retries: 0,
        retry_backoff_seconds: 1,
      });
    });

    // The store action no-ops — no new config entry should be created
    const configs = useMockStore.getState().notificationConfigs;
    expect(configs['nonexistent-tenant-id']).toBeUndefined();
  });
});
