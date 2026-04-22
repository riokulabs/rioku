/**
 * Unit tests for rbac-policies feature.
 *
 * Monaco and router are mocked inline — same pattern as data-table tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

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
        aria-label="cel-editor"
        data-testid="monaco-stub"
        value={value ?? ''}
        readOnly={options?.readOnly ?? false}
        onChange={(e) => onChange?.(e.target.value)}
      />
    );
  };
  return { default: MockEditor };
});

vi.mock('@/lib/cel-parser', () => ({
  parseCel: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useBlocker: () => ({ status: 'idle' }),
}));

import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { RbacPolicyList } from '../components/list';
import { RbacPolicyEditor } from '../components/editor';

function wrap(ui: React.ReactNode) {
  return render(
    <MantineProvider>
      <ModalsProvider>{ui}</ModalsProvider>
    </MantineProvider>,
  );
}

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
});

describe('RbacPolicyList', () => {
  it('renders seeded 6 RBAC policies', () => {
    const onSelect = vi.fn();
    wrap(<RbacPolicyList onSelect={onSelect} />);
    const rows = screen.getAllByRole('row');
    // 6 data rows + 1 header = 7
    expect(rows.length).toBeGreaterThanOrEqual(7);
  });

  it('calls onSelect when a row is clicked', () => {
    const onSelect = vi.fn();
    wrap(<RbacPolicyList onSelect={onSelect} />);
    const dataRows = screen.getAllByRole('row').slice(1);
    const firstRow = dataRows[0];
    if (!firstRow) throw new Error('No rows found');
    fireEvent.click(firstRow);
    expect(onSelect).toHaveBeenCalledOnce();
  });
});

describe('RbacPolicyEditor', () => {
  it('does not call onSave when name is empty', async () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    wrap(<RbacPolicyEditor tenantId="t-1" onSave={onSave} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /create policy/i }));
    await new Promise((r) => setTimeout(r, 50));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('does not call onSave when no roles are selected', async () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    wrap(<RbacPolicyEditor tenantId="t-1" onSave={onSave} onCancel={onCancel} />);
    // Fill in a valid name
    const nameInputs = screen.getAllByRole('textbox');
    const nameInput = nameInputs[0];
    if (!nameInput) throw new Error('No textbox found');
    fireEvent.change(nameInput, {
      target: { value: 'test-rbac-policy' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create policy/i }));
    await new Promise((r) => setTimeout(r, 50));
    // No roles selected — validation should block
    expect(onSave).not.toHaveBeenCalled();
  });

  it('create action adds entry to the mock store', async () => {
    const initialCount = Object.keys(useMockStore.getState().rbacPolicies).length;
    const { createRbacPolicyMutation } = await import('../api');
    await createRbacPolicyMutation('t-acme', {
      name: 'test-policy',
      description: 'desc',
      policy_type: 'totp-required',
      affected_role_ids: ['role-1'],
    });
    const newCount = Object.keys(useMockStore.getState().rbacPolicies).length;
    expect(newCount).toBe(initialCount + 1);
  });
});
