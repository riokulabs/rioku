/**
 * Unit tests for roles feature.
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

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { useMockStore } from '@/api/mock-store';
import { seedStore } from '@/api/mock-seed';
import { RoleList } from '../components/list';
import { RoleCreate } from '../components/create';

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

describe('RoleList', () => {
  it('renders seeded 8 roles', () => {
    const onSelect = vi.fn();
    wrap(<RoleList onSelect={onSelect} />);
    const rows = screen.getAllByRole('row');
    // 8 data rows + 1 header = 9
    expect(rows.length).toBeGreaterThanOrEqual(9);
  });

  it('calls onSelect when a row is clicked', () => {
    const onSelect = vi.fn();
    wrap(<RoleList onSelect={onSelect} />);
    const dataRows = screen.getAllByRole('row').slice(1);
    const firstRow = dataRows[0];
    if (!firstRow) throw new Error('No rows found');
    fireEvent.click(firstRow);
    expect(onSelect).toHaveBeenCalledOnce();
  });
});

describe('RoleCreate', () => {
  it('does not call onSave when name is empty', async () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    wrap(<RoleCreate tenantId="t-1" onSave={onSave} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /create role/i }));
    await new Promise((r) => setTimeout(r, 50));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('calls onSave with valid name', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();
    wrap(<RoleCreate tenantId="t-1" onSave={onSave} onCancel={onCancel} />);
    // Find the name input — first text input
    const inputs = screen.getAllByRole('textbox');
    const nameInput = inputs[0];
    if (!nameInput) throw new Error('No textbox found');
    // Name is the first input
    fireEvent.change(nameInput, {
      target: { value: 'my-new-role' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create role/i }));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledOnce();
    });
  });
});

describe('Cycle detection', () => {
  it('detectRoleCycle returns true for a role with itself as parent', async () => {
    const { detectRoleCycle } = await import('@/host/role-resolver');
    const roles = useMockStore.getState().roles;
    const firstRole = Object.values(roles)[0];
    if (!firstRole) throw new Error('No roles seeded');

    const selfParent = { ...firstRole, parent_ids: [firstRole.id] };
    const result = detectRoleCycle(selfParent, { ...roles, [firstRole.id]: selfParent });
    expect(result).toBe(true);
  });

  it('validateRoleSave rejects self-parent', async () => {
    const { validateRoleSave } = await import('@/host/role-resolver');
    const roles = useMockStore.getState().roles;
    const firstRole = Object.values(roles)[0];
    if (!firstRole) throw new Error('No roles seeded');

    const result = validateRoleSave({ ...firstRole, parent_ids: [firstRole.id] }, roles);
    expect(result.ok).toBe(false);
  });
});

describe('Delete with affected users', () => {
  it('renders delete confirm with role name', async () => {
    const { RoleDeleteConfirm } = await import('../components/delete-confirm');
    const roles = useMockStore.getState().roles;
    const firstRole = Object.values(roles)[0];
    if (!firstRole) throw new Error('No roles seeded');

    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();

    wrap(<RoleDeleteConfirm role={firstRole} onConfirm={onConfirm} onCancel={onCancel} />);

    // Should show the role name and a delete button
    expect(screen.getByText(firstRole.name)).toBeDefined();
    expect(screen.getByRole('button', { name: /delete role/i })).toBeDefined();
  });
});
