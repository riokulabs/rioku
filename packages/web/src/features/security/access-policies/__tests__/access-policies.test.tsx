/**
 * Unit tests for access-policies feature.
 *
 * Monaco and router are mocked — same pattern as data-table and condition-editor tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock @monaco-editor/react ─────────────────────────────────────────────────
vi.mock('@monaco-editor/react', async () => {
  const { useEffect } = await import('react');
  const MockEditor = ({
    value,
    onChange,
    onMount,
    options,
  }: {
    value?: string;
    onChange?: (v: string | undefined) => void;
    onMount?: (editor: unknown, monaco: unknown) => void;
    options?: { readOnly?: boolean };
  }) => {
    useEffect(() => {
      if (onMount) {
        const fakeModel = {};
        const fakeEditor = { getModel: () => fakeModel };
        const fakeMonaco = {
          editor: { setModelMarkers: vi.fn() },
          MarkerSeverity: { Error: 8 },
          languages: {
            register: vi.fn(),
            setMonarchTokensProvider: vi.fn(),
            setLanguageConfiguration: vi.fn(),
          },
        };
        onMount(fakeEditor, fakeMonaco);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return (
      <textarea
        aria-label="CEL Condition"
        data-testid="monaco-stub"
        value={value ?? ''}
        readOnly={options?.readOnly ?? false}
        onChange={(e) => onChange?.(e.target.value)}
      />
    );
  };
  return { default: MockEditor };
});

// ── Mock cel-parser ───────────────────────────────────────────────────────────
vi.mock('@/lib/cel-parser', () => ({
  parseCel: vi.fn().mockResolvedValue({ ok: true }),
}));

// ── Mock TanStack Router (same pattern as data-table tests) ──────────────────
vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useBlocker: () => ({ status: 'idle' }),
}));

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { AccessPolicyList } from '../components/list';
import { AccessPolicyEditor } from '../components/editor';

// ─── Wrapper ──────────────────────────────────────────────────────────────────

function wrap(ui: React.ReactNode) {
  return render(
    <MantineProvider>
      <ModalsProvider>{ui}</ModalsProvider>
    </MantineProvider>,
  );
}

// ─── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
});

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('AccessPolicyList', () => {
  it('renders seeded 15 policies', () => {
    const onSelect = vi.fn();
    wrap(<AccessPolicyList onSelect={onSelect} />);
    const rows = screen.getAllByRole('row');
    // rows includes the header row
    expect(rows.length).toBeGreaterThanOrEqual(16);
  });

  it('calls onSelect when a row is clicked', () => {
    const onSelect = vi.fn();
    wrap(<AccessPolicyList onSelect={onSelect} />);
    const dataRows = screen.getAllByRole('row').slice(1); // skip header
    const firstRow = dataRows[0];
    if (!firstRow) throw new Error('No rows found');
    fireEvent.click(firstRow);
    expect(onSelect).toHaveBeenCalledOnce();
  });
});

describe('AccessPolicyEditor', () => {
  it('does not call onSave when name is empty', async () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    wrap(
      <AccessPolicyEditor
        tenantId="tenant-1"
        onSave={onSave}
        onCancel={onCancel}
      />,
    );
    const saveBtn = screen.getByRole('button', { name: /create policy/i });
    // Name input is empty by default — form validation should block submission
    fireEvent.click(saveBtn);
    // Wait a tick to allow any async form processing to complete
    await new Promise((r) => setTimeout(r, 50));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('calls onSave with valid form values', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();
    wrap(
      <AccessPolicyEditor
        tenantId="tenant-1"
        onSave={onSave}
        onCancel={onCancel}
      />,
    );
    const nameInput = screen.getByRole('textbox', { name: /name/i });
    fireEvent.change(nameInput, { target: { value: 'test-policy' } });

    // Set condition via the mocked textarea
    const conditionInput = screen.getByRole('textbox', { name: /cel condition/i });
    fireEvent.change(conditionInput, { target: { value: 'true' } });

    const saveBtn = screen.getByRole('button', { name: /create policy/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledOnce();
    });
  });

  it('save action adds a new entry to the mock store', async () => {
    const initialCount = Object.keys(useMockStore.getState().accessPolicies).length;
    const { createAccessPolicyMutation } = await import('../api');
    await createAccessPolicyMutation('tenant-acme', {
      name: 'new-policy-from-test',
      condition: 'true',
      action: 'allow',
      priority: 100,
      enabled: true,
    });
    const newCount = Object.keys(useMockStore.getState().accessPolicies).length;
    expect(newCount).toBe(initialCount + 1);
  });
});
