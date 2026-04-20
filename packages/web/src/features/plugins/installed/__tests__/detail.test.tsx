/**
 * Unit tests for <InstalledPluginDetail> — Plan 6 (Task 6b.5) enhancements.
 *
 * Covers:
 *   - Signer chip renders with signer name + short fingerprint + status colour
 *   - Unsigned plugins show the orange "Unsigned" badge
 *   - Build-log accordion renders only when `last_build_log` is set
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
  Link: ({ children, ...props }: { children?: React.ReactNode }) => (
    <a {...(props as Record<string, unknown>)}>{children}</a>
  ),
}));

import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { InstalledPluginDetail } from '../components/detail';

function wrap(ui: React.ReactNode) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
});

describe('<InstalledPluginDetail> — signer chip', () => {
  it('renders the signer chip with short fingerprint for signed plugins', () => {
    // Pick any seeded plugin that has a signer_id.
    const plugin = Object.values(useMockStore.getState().plugins).find(
      (p) => p.signer_id !== undefined,
    );
    if (!plugin) throw new Error('seed fixture missing signed plugin');
    const signer =
      useMockStore.getState().pluginSigners[plugin.signer_id ?? ''];
    if (!signer) throw new Error('seed fixture missing signer for plugin');

    wrap(
      <InstalledPluginDetail
        pluginId={plugin.id}
        tenantSlug="acme"
        onUninstall={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const chip = screen.getByTestId('plugin-signer-chip');
    expect(chip.textContent).toContain(signer.name);
    expect(chip.textContent).toContain(signer.fingerprint.slice(0, 8));
    // The status is propagated as a data-attribute for UI testing.
    expect(chip.getAttribute('data-status')).toBe(signer.status);
  });

  it('renders the Unsigned chip when the plugin has no signer_id', () => {
    // Directly mutate the signer_id on a seeded plugin so the chip renders
    // the Unsigned state. We cannot pass `undefined` through updateEntity()
    // because exactOptionalPropertyTypes rejects explicit-undefined writes.
    const state = useMockStore.getState();
    const existing = Object.values(state.plugins)[0];
    if (!existing) throw new Error('need at least one seeded plugin');
    useMockStore.setState((s) => {
      const target = s.plugins[existing.id];
      if (!target) return s;
      // Rebuild without signer_id to satisfy exactOptionalPropertyTypes.
      const rest: typeof target = { ...target };
      delete rest.signer_id;
      return { ...s, plugins: { ...s.plugins, [existing.id]: rest } };
    });

    wrap(
      <InstalledPluginDetail
        pluginId={existing.id}
        tenantSlug="acme"
        onUninstall={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByTestId('plugin-signer-chip-unsigned')).toBeTruthy();
  });
});

describe('<InstalledPluginDetail> — build log accordion', () => {
  it('renders the accordion when last_build_log is present', () => {
    const broken = Object.values(useMockStore.getState().plugins).find(
      (p) => p.slug === 'com.example.broken-plugin',
    );
    if (!broken) throw new Error('seed fixture missing broken-plugin');

    wrap(
      <InstalledPluginDetail
        pluginId={broken.id}
        tenantSlug="acme"
        onUninstall={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByTestId('plugin-build-log-accordion')).toBeTruthy();
  });

  it('omits the accordion when no build log is present', () => {
    const plugin = Object.values(useMockStore.getState().plugins).find(
      (p) => p.last_build_log === undefined,
    );
    if (!plugin) throw new Error('seed fixture missing log-less plugin');

    wrap(
      <InstalledPluginDetail
        pluginId={plugin.id}
        tenantSlug="acme"
        onUninstall={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('plugin-build-log-accordion')).toBeNull();
  });
});
