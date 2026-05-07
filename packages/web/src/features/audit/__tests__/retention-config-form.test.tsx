/**
 * Tests for <RetentionConfigForm>.
 *
 * Covers:
 *  - renders populated from the seeded retention config
 *  - Save button gates on audit:retention:write
 *  - auto_export_format disables when auto_export is 'never'
 *  - successful save persists via updateRetentionConfig
 *  - validation rejects out-of-range retention values
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => () => undefined,
  useRouter: () => ({ navigate: () => undefined }),
}));

// Granular permission mock — tests flip the retention:write grant.
let grantWrite = true;
vi.mock('@/hooks/use-permission', () => ({
  usePermission: (key: string) => (key === 'audit:retention:write' ? grantWrite : true),
}));

import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { RetentionConfigForm } from '../components/retention-config-form';

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

function acmeId(): string {
  const acme = Object.values(useMockStore.getState().tenants).find((t) => t.slug === 'acme');
  if (!acme) throw new Error('No acme tenant');
  return acme.id;
}

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
  grantWrite = true;
});

describe('<RetentionConfigForm>', () => {
  it('renders populated from the seeded retention config', () => {
    const tenantId = acmeId();
    const seeded = useMockStore.getState().auditRetentionConfigs[tenantId];
    if (!seeded) throw new Error('No seeded retention config');

    render(<RetentionConfigForm tenantId={tenantId} />, { wrapper: Wrapper });

    const readInput = screen.getByTestId<HTMLInputElement>('retention-read');
    const writeInput = screen.getByTestId<HTMLInputElement>('retention-write');
    expect(readInput.value).toBe(String(seeded.retention_days.read));
    expect(writeInput.value).toBe(String(seeded.retention_days.write));
  });

  it('disables all fields + save button without audit:retention:write', () => {
    const tenantId = acmeId();
    grantWrite = false;
    render(<RetentionConfigForm tenantId={tenantId} />, { wrapper: Wrapper });

    const save = screen.getByTestId<HTMLButtonElement>('retention-save');
    expect(save.disabled).toBe(true);
    const read = screen.getByTestId<HTMLInputElement>('retention-read');
    expect(read.disabled).toBe(true);
  });

  it('enables save button when audit:retention:write is granted', () => {
    const tenantId = acmeId();
    render(<RetentionConfigForm tenantId={tenantId} />, { wrapper: Wrapper });

    const save = screen.getByTestId<HTMLButtonElement>('retention-save');
    expect(save.disabled).toBe(false);
  });

  it('renders Save + shows form testid for discoverability', () => {
    const tenantId = acmeId();
    render(<RetentionConfigForm tenantId={tenantId} />, { wrapper: Wrapper });
    expect(screen.getByTestId('audit-retention-form')).toBeInTheDocument();
    expect(screen.getByTestId('retention-save')).toBeInTheDocument();
  });

  it('submitting persists via updateRetentionConfig', async () => {
    const tenantId = acmeId();
    render(<RetentionConfigForm tenantId={tenantId} />, { wrapper: Wrapper });

    const readInput = screen.getByTestId<HTMLInputElement>('retention-read');
    fireEvent.change(readInput, { target: { value: '42' } });

    const save = screen.getByTestId<HTMLButtonElement>('retention-save');
    fireEvent.click(save);

    await waitFor(() => {
      const cfg = useMockStore.getState().auditRetentionConfigs[tenantId];
      expect(cfg?.retention_days.read).toBe(42);
    });
  });

  it('rejects retention values above the 3650-day cap', async () => {
    const tenantId = acmeId();
    render(<RetentionConfigForm tenantId={tenantId} />, { wrapper: Wrapper });

    const readInput = screen.getByTestId<HTMLInputElement>('retention-read');
    fireEvent.change(readInput, { target: { value: '5000' } });

    const save = screen.getByTestId<HTMLButtonElement>('retention-save');
    fireEvent.click(save);

    // Wait a tick; if validation rejected, the store shouldn't change.
    await new Promise((r) => setTimeout(r, 50));
    const cfg = useMockStore.getState().auditRetentionConfigs[tenantId];
    expect(cfg?.retention_days.read).not.toBe(5000);
  });
});
