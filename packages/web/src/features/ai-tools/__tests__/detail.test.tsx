/**
 * Unit tests for <ToolDetail>.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
}));

import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { ToolDetail } from '../components/detail';

function wrap(ui: React.ReactNode) {
  return render(
    <MantineProvider>
      <Notifications />
      <ModalsProvider>{ui}</ModalsProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
});

function firstToolId(): string {
  const state = useMockStore.getState();
  const acme = Object.values(state.tenants).find((t) => t.slug === 'acme');
  if (!acme) throw new Error('No acme tenant seeded');
  const t = Object.values(state.aiTools).find((tl) => tl.tenant_id === acme.id);
  if (!t) throw new Error('No tool seeded');
  return t.id;
}

describe('ToolDetail', () => {
  it('renders tool header, schema, test panel sections', () => {
    wrap(
      <ToolDetail
        toolId={firstToolId()}
        onEdit={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getAllByText(/JSON schema/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Test/i).length).toBeGreaterThan(0);
  });

  it('shows error alert when tool not found', () => {
    wrap(
      <ToolDetail
        toolId="does-not-exist"
        onEdit={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/Tool not found/i)).toBeInTheDocument();
  });
});
