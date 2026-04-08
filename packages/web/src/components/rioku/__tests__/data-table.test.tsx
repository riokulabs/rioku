import { describe, it, expect } from 'vitest'
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
})
