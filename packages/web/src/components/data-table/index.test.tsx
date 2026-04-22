/**
 * DataTable tests.
 *
 * TanStack Router (useSearch / useNavigate) is mocked at the module level
 * so tests run without a real router context, matching the pattern used by
 * use-opaque-filter.test.ts in this codebase.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { axe } from 'jest-axe';
import type { ColumnDef } from '@tanstack/react-table';

// ── Mock TanStack Router ─────────────────────────────────────────────────────

let mockSearch: Record<string, unknown> = {};
const mockNavigate = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => mockSearch,
  useNavigate: () => mockNavigate,
}));

// Import AFTER mocks
import { DataTable } from './index';

// ── Test data ────────────────────────────────────────────────────────────────

interface Person {
  id: string;
  name: string;
  age: number;
  status: string;
}

const PEOPLE: Person[] = [
  { id: '1', name: 'Alice', age: 30, status: 'active' },
  { id: '2', name: 'Bob', age: 25, status: 'inactive' },
  { id: '3', name: 'Carol', age: 35, status: 'active' },
  { id: '4', name: 'Dave', age: 28, status: 'pending' },
  { id: '5', name: 'Eve', age: 22, status: 'active' },
];

const COLUMNS: ColumnDef<Person>[] = [
  { accessorKey: 'name', header: 'Name', enableSorting: true },
  { accessorKey: 'age', header: 'Age', enableSorting: true },
  { accessorKey: 'status', header: 'Status', enableSorting: false },
];

// ── Wrapper ───────────────────────────────────────────────────────────────────

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MantineProvider>{children}</MantineProvider>;
}

function renderTable(props: Partial<Parameters<typeof DataTable<Person>>[0]> = {}) {
  const defaultProps = {
    data: PEOPLE,
    columns: COLUMNS,
  };
  return render(<DataTable<Person> {...defaultProps} {...props} />, { wrapper: Wrapper });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DataTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearch = {};
  });

  // ── Row rendering ──────────────────────────────────────────────────────────

  describe('row rendering', () => {
    it('renders all rows from data', () => {
      renderTable();
      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('Bob')).toBeInTheDocument();
      expect(screen.getByText('Carol')).toBeInTheDocument();
      expect(screen.getByText('Dave')).toBeInTheDocument();
      expect(screen.getByText('Eve')).toBeInTheDocument();
    });

    it('renders column headers', () => {
      renderTable();
      expect(screen.getByText('Name')).toBeInTheDocument();
      expect(screen.getByText('Age')).toBeInTheDocument();
      expect(screen.getByText('Status')).toBeInTheDocument();
    });

    it('renders a caption when provided', () => {
      renderTable({ caption: 'People directory' });
      expect(screen.getByText('People directory')).toBeInTheDocument();
    });
  });

  // ── Empty state ────────────────────────────────────────────────────────────

  describe('empty state', () => {
    it('renders default empty state when data is empty', () => {
      renderTable({ data: [] });
      expect(screen.getByText('No results')).toBeInTheDocument();
    });

    it('renders custom emptyState when provided', () => {
      renderTable({ data: [], emptyState: <div>Custom empty</div> });
      expect(screen.getByText('Custom empty')).toBeInTheDocument();
    });
  });

  // ── Loading state ──────────────────────────────────────────────────────────

  describe('loading state', () => {
    it('renders default loading state when isLoading', () => {
      renderTable({ isLoading: true });
      expect(screen.getByLabelText('Loading')).toBeInTheDocument();
    });

    it('renders custom loadingState when provided', () => {
      renderTable({ isLoading: true, loadingState: <div>Loading…</div> });
      expect(screen.getByText('Loading…')).toBeInTheDocument();
    });

    it('loading state takes precedence over data', () => {
      renderTable({ isLoading: true });
      expect(screen.queryByText('Alice')).not.toBeInTheDocument();
    });
  });

  // ── Error state ────────────────────────────────────────────────────────────

  describe('error state', () => {
    it('renders default error state when isError', () => {
      renderTable({ isError: true });
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });

    it('renders custom errorState when provided', () => {
      renderTable({ isError: true, errorState: <div>Custom error</div> });
      expect(screen.getByText('Custom error')).toBeInTheDocument();
    });

    it('error state takes precedence over loading state', () => {
      renderTable({ isError: true, isLoading: true });
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      expect(screen.queryByLabelText('Loading')).not.toBeInTheDocument();
    });
  });

  // ── Pagination ─────────────────────────────────────────────────────────────

  describe('pagination', () => {
    const MANY_PEOPLE: Person[] = Array.from({ length: 30 }, (_, i) => ({
      id: String(i + 1),
      name: `Person ${String(i + 1)}`,
      age: 20 + i,
      status: 'active',
    }));

    it('shows only pageSize rows on the first page', () => {
      renderTable({ data: MANY_PEOPLE, pagination: { pageSize: 10 } });
      expect(screen.getByText('Person 1')).toBeInTheDocument();
      expect(screen.queryByText('Person 11')).not.toBeInTheDocument();
    });

    it('shows the row count summary', () => {
      renderTable({ data: MANY_PEOPLE, pagination: { pageSize: 10 } });
      expect(screen.getByText('Showing 1–10 of 30')).toBeInTheDocument();
    });

    it('navigates to page 2 when page 2 button is clicked', async () => {
      const user = userEvent.setup();
      renderTable({ data: MANY_PEOPLE, pagination: { pageSize: 10 } });

      // Mantine Pagination renders page buttons with aria-label "Page N" when getItemProps is set
      const page2 = screen.getByRole('button', { name: 'Page 2' });
      await user.click(page2);

      expect(screen.getByText('Person 11')).toBeInTheDocument();
      expect(screen.queryByText('Person 1')).not.toBeInTheDocument();
    });

    it('changes page size when selector is changed', async () => {
      const user = userEvent.setup();
      renderTable({ data: MANY_PEOPLE, pagination: { pageSize: 10 } });

      expect(screen.queryByText('Person 11')).not.toBeInTheDocument();

      const select = screen.getByRole('combobox', { name: 'Rows per page' });
      await user.click(select);
      const option25 = await screen.findByText('25 / page');
      await user.click(option25);

      expect(screen.getByText('Person 11')).toBeInTheDocument();
    });
  });

  // ── Sorting ────────────────────────────────────────────────────────────────

  describe('sorting', () => {
    it('sorts column ascending on first header click', async () => {
      const user = userEvent.setup();
      renderTable({ sorting: true });

      const nameHeader = screen.getByText('Name');
      await user.click(nameHeader);

      const th = nameHeader.closest('th');
      expect(th).toHaveAttribute('aria-sort', 'ascending');
    });

    it('sorts column descending on second header click', async () => {
      const user = userEvent.setup();
      renderTable({ sorting: true });

      const nameHeader = screen.getByText('Name');
      await user.click(nameHeader); // asc
      await user.click(nameHeader); // desc

      const th = nameHeader.closest('th');
      expect(th).toHaveAttribute('aria-sort', 'descending');
    });

    it('removes sort on third click (back to none — aria-sort absent)', async () => {
      const user = userEvent.setup();
      renderTable({ sorting: true });

      const nameHeader = screen.getByText('Name');
      await user.click(nameHeader); // asc
      await user.click(nameHeader); // desc
      await user.click(nameHeader); // none → aria-sort removed

      const th = nameHeader.closest('th');
      // When no sort is active, aria-sort should be absent (not "none")
      expect(th).not.toHaveAttribute('aria-sort');
    });

    it('does not expose aria-sort on non-sortable columns', () => {
      renderTable({ sorting: true });
      const statusHeader = screen.getByText('Status');
      const th = statusHeader.closest('th');
      expect(th).not.toHaveAttribute('aria-sort');
    });
  });

  // ── Global filtering ───────────────────────────────────────────────────────

  describe('global filtering', () => {
    it('renders search input when filtering is global', () => {
      renderTable({ filtering: 'global' });
      expect(screen.getByRole('textbox', { name: 'Search table' })).toBeInTheDocument();
    });

    it('filters rows as the user types', async () => {
      const user = userEvent.setup();
      renderTable({ filtering: 'global' });

      const searchInput = screen.getByRole('textbox', { name: 'Search table' });
      await user.type(searchInput, 'Alice');

      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.queryByText('Bob')).not.toBeInTheDocument();
    });

    it('shows all rows again when filter is cleared', async () => {
      const user = userEvent.setup();
      renderTable({ filtering: 'global' });

      const searchInput = screen.getByRole('textbox', { name: 'Search table' });
      await user.type(searchInput, 'Alice');
      await user.clear(searchInput);

      expect(screen.getByText('Bob')).toBeInTheDocument();
      expect(screen.getByText('Carol')).toBeInTheDocument();
    });
  });

  // ── onRowClick ─────────────────────────────────────────────────────────────

  describe('onRowClick', () => {
    it('calls onRowClick with row data when a row is clicked', async () => {
      const user = userEvent.setup();
      const onRowClick = vi.fn();
      renderTable({ onRowClick });

      await user.click(screen.getByText('Alice'));
      expect(onRowClick).toHaveBeenCalledWith(PEOPLE[0]);
    });

    it('calls onRowClick when Enter is pressed on a focused row', async () => {
      const user = userEvent.setup();
      const onRowClick = vi.fn();
      renderTable({ onRowClick });

      const aliceCell = screen.getByText('Alice');
      const aliceRow = aliceCell.closest('tr');
      if (!aliceRow) throw new Error('Row not found');
      aliceRow.focus();
      await user.keyboard('{Enter}');

      expect(onRowClick).toHaveBeenCalledWith(PEOPLE[0]);
    });
  });

  // ── URL sync ───────────────────────────────────────────────────────────────

  describe('URL sync', () => {
    it('calls navigate with sort param when urlSyncKey is set and sort changes', async () => {
      const user = userEvent.setup();
      renderTable({ sorting: true, urlSyncKey: 'services' });

      const nameHeader = screen.getByText('Name');
      await user.click(nameHeader);

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalled();
      });

      // Find a navigate call that encodes the sort param
      const hasSortParam = mockNavigate.mock.calls.some((call) => {
        const opts = call[0] as {
          search?: (prev: Record<string, unknown>) => Record<string, unknown>;
        };
        if (typeof opts.search !== 'function') return false;
        const result = opts.search({});
        return typeof result.services_sort === 'string';
      });
      expect(hasSortParam).toBe(true);
    });

    it('initialises pagination from URL search params when urlSyncKey is set', () => {
      // Simulate URL already containing page 2 state
      mockSearch = { services_p: '2', services_s: '10' };

      const MANY: Person[] = Array.from({ length: 30 }, (_, i) => ({
        id: String(i + 1),
        name: `Person ${String(i + 1)}`,
        age: 20 + i,
        status: 'active',
      }));

      renderTable({
        data: MANY,
        pagination: { pageSize: 10 },
        urlSyncKey: 'services',
      });

      // Page 2 with size 10 → rows 11-20
      expect(screen.getByText('Person 11')).toBeInTheDocument();
      expect(screen.queryByText('Person 1')).not.toBeInTheDocument();
    });
  });

  // ── Accessibility ──────────────────────────────────────────────────────────

  describe('accessibility', () => {
    it('has no critical axe violations on basic render', async () => {
      const { container } = renderTable();
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('has no critical axe violations in empty state', async () => {
      const { container } = renderTable({ data: [] });
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('has no critical axe violations in loading state with custom loadingState', async () => {
      // Note: the default <LoadingState> has a pre-existing aria-label on a div without role —
      // that violation lives in the shared LoadingState component, not in DataTable itself.
      // This test uses a custom loadingState to verify DataTable's own axe compliance.
      const { container } = renderTable({
        isLoading: true,
        loadingState: (
          <div role="status" aria-label="Loading table data">
            Loading…
          </div>
        ),
      });
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('has no critical axe violations with pagination and sorting enabled', async () => {
      const { container } = renderTable({
        pagination: { pageSize: 3 },
        sorting: true,
      });
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });
});
