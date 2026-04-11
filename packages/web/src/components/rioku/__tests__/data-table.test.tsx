import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DataTable, type Column } from '../data-table'

interface TestRow {
  id: string
  name: string
  status: string
  [key: string]: unknown
}

const columns: Column<TestRow>[] = [
  { key: 'name', header: 'Name', sortable: true },
  { key: 'status', header: 'Status' },
]

const data: TestRow[] = [
  { id: '1', name: 'Alpha Route', status: 'active' },
  { id: '2', name: 'Beta Route', status: 'inactive' },
  { id: '3', name: 'Gamma Route', status: 'active' },
]

describe('DataTable', () => {
  // ---- Original tests (backwards compatibility) ----

  it('renders column headers from config', () => {
    render(<DataTable columns={columns} data={data} />)

    expect(screen.getByText('Name')).toBeInTheDocument()
    expect(screen.getByText('Status')).toBeInTheDocument()
  })

  it('renders rows from data', () => {
    render(<DataTable columns={columns} data={data} />)

    expect(screen.getByText('Alpha Route')).toBeInTheDocument()
    expect(screen.getByText('Beta Route')).toBeInTheDocument()
    expect(screen.getByText('Gamma Route')).toBeInTheDocument()
  })

  it('uses custom render function for column', () => {
    const customColumns: Column<TestRow>[] = [
      {
        key: 'name',
        header: 'Name',
        render: (row) => <strong data-testid="custom">{row.name}</strong>,
      },
    ]

    render(<DataTable columns={customColumns} data={data} />)

    expect(screen.getAllByTestId('custom')).toHaveLength(3)
  })

  it('renders search input when searchable', () => {
    render(<DataTable columns={columns} data={data} searchable />)

    expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument()
  })

  it('filters rows by search text (case-insensitive)', async () => {
    const user = userEvent.setup()
    render(<DataTable columns={columns} data={data} searchable />)

    await user.type(screen.getByPlaceholderText('Search...'), 'alpha')

    expect(screen.getByText('Alpha Route')).toBeInTheDocument()
    expect(screen.queryByText('Beta Route')).not.toBeInTheDocument()
    expect(screen.queryByText('Gamma Route')).not.toBeInTheDocument()
  })

  it('searches across all columns', async () => {
    const user = userEvent.setup()
    render(<DataTable columns={columns} data={data} searchable />)

    await user.type(screen.getByPlaceholderText('Search...'), 'inactive')

    expect(screen.getByText('Beta Route')).toBeInTheDocument()
    expect(screen.queryByText('Alpha Route')).not.toBeInTheDocument()
  })

  it('uses custom search placeholder', () => {
    render(
      <DataTable
        columns={columns}
        data={data}
        searchable
        searchPlaceholder="Find routes..."
      />,
    )

    expect(screen.getByPlaceholderText('Find routes...')).toBeInTheDocument()
  })

  it('paginates data', () => {
    render(<DataTable columns={columns} data={data} pageSize={2} />)

    // First page: 2 rows
    expect(screen.getByText('Alpha Route')).toBeInTheDocument()
    expect(screen.getByText('Beta Route')).toBeInTheDocument()
    expect(screen.queryByText('Gamma Route')).not.toBeInTheDocument()
  })

  it('navigates pages with next/prev buttons', async () => {
    const user = userEvent.setup()
    render(<DataTable columns={columns} data={data} pageSize={2} />)

    // Go to next page
    await user.click(screen.getByRole('button', { name: /next page/i }))

    expect(screen.queryByText('Alpha Route')).not.toBeInTheDocument()
    expect(screen.getByText('Gamma Route')).toBeInTheDocument()

    // Go back to previous page
    await user.click(screen.getByRole('button', { name: /previous page/i }))

    expect(screen.getByText('Alpha Route')).toBeInTheDocument()
  })

  it('sorts rows when sortable header is clicked', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <DataTable columns={columns} data={data} />,
    )

    // Click the sortable Name header
    const sortButton = screen.getByRole('button', { name: /name/i })
    await user.click(sortButton)

    // Rows should be sorted ascending by name
    const rows = container.querySelectorAll('tbody tr')
    expect(rows[0]).toHaveTextContent('Alpha Route')
    expect(rows[1]).toHaveTextContent('Beta Route')
    expect(rows[2]).toHaveTextContent('Gamma Route')

    // Click again for descending
    await user.click(sortButton)
    const rowsDesc = container.querySelectorAll('tbody tr')
    expect(rowsDesc[0]).toHaveTextContent('Gamma Route')
  })

  it('renders empty state when no data', () => {
    render(<DataTable columns={columns} data={[]} />)

    expect(screen.getByText('No results')).toBeInTheDocument()
  })

  it('renders custom empty state', () => {
    render(
      <DataTable
        columns={columns}
        data={[]}
        emptyState={<div>Custom empty</div>}
      />,
    )

    expect(screen.getByText('Custom empty')).toBeInTheDocument()
  })

  it('renders actions slot in header', () => {
    render(
      <DataTable
        columns={columns}
        data={data}
        actions={<button>Add</button>}
      />,
    )

    expect(screen.getByText('Add')).toBeInTheDocument()
  })

  it('renders title in header', () => {
    render(
      <DataTable columns={columns} data={data} title="Routes" />,
    )

    expect(screen.getByText('Routes')).toBeInTheDocument()
  })

  it('shows dash for null/undefined cell values', () => {
    const dataWithNull: TestRow[] = [
      { id: '1', name: 'Test', status: undefined as unknown as string },
    ]
    render(<DataTable columns={columns} data={dataWithNull} />)

    // The em dash character
    expect(screen.getByText('\u2014')).toBeInTheDocument()
  })

  // ---- New feature tests ----

  describe('link column', () => {
    it('renders link column as clickable primary-colored link', () => {
      render(
        <DataTable
          columns={columns}
          data={data}
          rowKey={(r) => r.id}
          linkColumn="name"
          onRowClick={vi.fn()}
        />,
      )

      const linkCells = screen.getAllByTestId('link-cell')
      expect(linkCells).toHaveLength(3)
      expect(linkCells[0]).toHaveTextContent('Alpha Route')
      expect(linkCells[0]).toHaveClass('text-primary')
    })

    it('calls onRowClick when link cell clicked', async () => {
      const onRowClick = vi.fn()
      const user = userEvent.setup()

      render(
        <DataTable
          columns={columns}
          data={data}
          rowKey={(r) => r.id}
          linkColumn="name"
          onRowClick={onRowClick}
        />,
      )

      const linkCells = screen.getAllByTestId('link-cell')
      await user.click(linkCells[0])

      expect(onRowClick).toHaveBeenCalledTimes(1)
      expect(onRowClick).toHaveBeenCalledWith(data[0])
    })
  })

  describe('row actions', () => {
    it('shows row actions on hover (verify className pattern)', () => {
      const { container } = render(
        <DataTable
          columns={columns}
          data={data}
          rowKey={(r) => r.id}
          rowActions={(row) => (
            <button data-testid={`action-${row.id}`}>Edit</button>
          )}
        />,
      )

      // Action buttons are rendered but hidden via opacity
      const actionButtons = screen.getAllByText('Edit')
      expect(actionButtons).toHaveLength(3)

      // The wrapper div should have the opacity-0 / group-hover:opacity-100 classes
      const actionWrappers = container.querySelectorAll('.opacity-0.group-hover\\:opacity-100')
      expect(actionWrappers.length).toBe(3)
    })

    it('renders actions column header as sr-only', () => {
      render(
        <DataTable
          columns={columns}
          data={data}
          rowKey={(r) => r.id}
          rowActions={() => <button>Edit</button>}
        />,
      )

      const srOnly = screen.getByText('Actions')
      expect(srOnly).toHaveClass('sr-only')
    })
  })

  describe('bulk selection', () => {
    it('renders checkbox column when selectable', () => {
      render(
        <DataTable
          columns={columns}
          data={data}
          rowKey={(r) => r.id}
          selectable
        />,
      )

      // Select-all checkbox + 3 row checkboxes
      const checkboxes = screen.getAllByRole('checkbox')
      expect(checkboxes.length).toBe(4) // 1 select-all + 3 rows
    })

    it('select-all checkbox toggles all rows', async () => {
      const onSelectionChange = vi.fn()
      const user = userEvent.setup()

      render(
        <DataTable
          columns={columns}
          data={data}
          rowKey={(r) => r.id}
          selectable
          onSelectionChange={onSelectionChange}
        />,
      )

      const selectAll = screen.getByRole('checkbox', { name: /select all/i })
      await user.click(selectAll)

      // Should have been called with all 3 ids (order doesn't matter)
      const lastCall = onSelectionChange.mock.calls[onSelectionChange.mock.calls.length - 1][0]
      expect(lastCall.sort()).toEqual(['1', '2', '3'])
    })

    it('individual row checkbox toggles selection', async () => {
      const onSelectionChange = vi.fn()
      const user = userEvent.setup()

      render(
        <DataTable
          columns={columns}
          data={data}
          rowKey={(r) => r.id}
          selectable
          onSelectionChange={onSelectionChange}
        />,
      )

      const rowCheckboxes = screen.getAllByRole('checkbox', { name: /select row/i })
      await user.click(rowCheckboxes[0])

      const lastCall = onSelectionChange.mock.calls[onSelectionChange.mock.calls.length - 1][0]
      expect(lastCall).toEqual(['1'])
    })

    it('renders bulk action bar when items selected', async () => {
      const user = userEvent.setup()

      render(
        <DataTable
          columns={columns}
          data={data}
          rowKey={(r) => r.id}
          selectable
          bulkActions={(ids) => (
            <button data-testid="bulk-delete">Delete {ids.length}</button>
          )}
        />,
      )

      // Initially no bulk action bar
      expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument()

      // Select a row
      const rowCheckboxes = screen.getAllByRole('checkbox', { name: /select row/i })
      await user.click(rowCheckboxes[0])

      // Bulk action bar appears
      expect(screen.getByTestId('bulk-action-bar')).toBeInTheDocument()
      expect(screen.getByTestId('bulk-delete')).toHaveTextContent('Delete 1')
    })
  })

  describe('faceted filtering', () => {
    const filterColumns = [
      {
        key: 'status',
        label: 'Status',
        options: [
          { label: 'Active', value: 'active' },
          { label: 'Inactive', value: 'inactive' },
        ],
      },
    ]

    it('renders filter buttons for filterColumns', () => {
      render(
        <DataTable
          columns={columns}
          data={data}
          rowKey={(r) => r.id}
          filterColumns={filterColumns}
        />,
      )

      // The filter button contains the label "Status" along with a filter icon
      const filterButtons = screen.getAllByText('Status')
      // One in the filter button, one in the table header
      expect(filterButtons.length).toBeGreaterThanOrEqual(2)
      // The filter trigger button should be present
      const trigger = screen.getByRole('button', { name: /status/i })
      expect(trigger).toBeInTheDocument()
    })
  })

  describe('density', () => {
    it('applies compact density padding', () => {
      const { container } = render(
        <DataTable
          columns={columns}
          data={data}
          rowKey={(r) => r.id}
          density="compact"
        />,
      )

      const cells = container.querySelectorAll('[data-slot="table-cell"]')
      expect(cells[0]?.className).toContain('py-1')
    })

    it('applies spacious density padding', () => {
      const { container } = render(
        <DataTable
          columns={columns}
          data={data}
          rowKey={(r) => r.id}
          density="spacious"
        />,
      )

      const cells = container.querySelectorAll('[data-slot="table-cell"]')
      expect(cells[0]?.className).toContain('py-3')
    })

    it('defaults to comfortable density padding', () => {
      const { container } = render(
        <DataTable
          columns={columns}
          data={data}
          rowKey={(r) => r.id}
        />,
      )

      const cells = container.querySelectorAll('[data-slot="table-cell"]')
      expect(cells[0]?.className).toContain('py-2')
    })
  })

  describe('column visibility', () => {
    it('hides columns with defaultVisible=false', () => {
      const columnsWithHidden: Column<TestRow>[] = [
        { key: 'name', header: 'Name' },
        { key: 'status', header: 'Status', defaultVisible: false },
      ]

      render(
        <DataTable
          columns={columnsWithHidden}
          data={data}
          rowKey={(r) => r.id}
        />,
      )

      expect(screen.getByText('Name')).toBeInTheDocument()
      // Status header should not be visible
      const headers = screen.getAllByRole('columnheader')
      const headerTexts = headers.map((h) => h.textContent)
      expect(headerTexts).not.toContain('Status')
    })
  })

  describe('rowKey', () => {
    it('uses rowKey function for unique keys', () => {
      const { container } = render(
        <DataTable
          columns={columns}
          data={data}
          rowKey={(r) => r.id}
        />,
      )

      const rows = container.querySelectorAll('tbody tr')
      expect(rows).toHaveLength(3)
    })
  })
})
