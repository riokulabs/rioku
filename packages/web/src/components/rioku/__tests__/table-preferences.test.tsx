import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TablePreferences, type ColumnVisibility } from '../table-preferences'

const columns: ColumnVisibility[] = [
  { key: 'name', header: 'Name', visible: true, hideable: true },
  { key: 'status', header: 'Status', visible: true, hideable: true },
  { key: 'id', header: 'ID', visible: false, hideable: true },
  { key: 'actions', header: 'Actions', visible: true, hideable: false },
]

const defaultProps = {
  columns,
  onColumnToggle: vi.fn(),
  density: 'comfortable' as const,
  onDensityChange: vi.fn(),
  pageSize: 25,
  onPageSizeChange: vi.fn(),
}

describe('TablePreferences', () => {
  it('renders gear icon button', () => {
    render(<TablePreferences {...defaultProps} />)

    expect(
      screen.getByRole('button', { name: /table preferences/i }),
    ).toBeInTheDocument()
  })

  it('opens preferences popover on click', async () => {
    const user = userEvent.setup()
    render(<TablePreferences {...defaultProps} />)

    await user.click(
      screen.getByRole('button', { name: /table preferences/i }),
    )

    expect(screen.getByText('Preferences')).toBeInTheDocument()
  })

  it('shows column toggles', async () => {
    const user = userEvent.setup()
    render(<TablePreferences {...defaultProps} />)

    await user.click(
      screen.getByRole('button', { name: /table preferences/i }),
    )

    // Only hideable columns should appear as toggles
    expect(screen.getByText('Name')).toBeInTheDocument()
    expect(screen.getByText('Status')).toBeInTheDocument()
    expect(screen.getByText('ID')).toBeInTheDocument()
    // Non-hideable column should not appear as a toggle
    // 'Actions' header won't appear because hideable=false
  })

  it('only shows hideable columns as toggles', async () => {
    const user = userEvent.setup()
    render(<TablePreferences {...defaultProps} />)

    await user.click(
      screen.getByRole('button', { name: /table preferences/i }),
    )

    const checkboxes = screen.getAllByRole('checkbox')
    // Only 3 hideable columns
    expect(checkboxes).toHaveLength(3)
  })

  it('calls onColumnToggle when checkbox changed', async () => {
    const onColumnToggle = vi.fn()
    const user = userEvent.setup()

    render(<TablePreferences {...defaultProps} onColumnToggle={onColumnToggle} />)

    await user.click(
      screen.getByRole('button', { name: /table preferences/i }),
    )

    // Click the 'Name' toggle (currently visible, so unchecking)
    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[0])

    expect(onColumnToggle).toHaveBeenCalledWith('name', false)
  })

  it('shows density options', async () => {
    const user = userEvent.setup()
    render(<TablePreferences {...defaultProps} />)

    await user.click(
      screen.getByRole('button', { name: /table preferences/i }),
    )

    expect(screen.getByText('Compact')).toBeInTheDocument()
    expect(screen.getByText('Comfortable')).toBeInTheDocument()
    expect(screen.getByText('Spacious')).toBeInTheDocument()
  })

  it('calls onDensityChange when density option clicked', async () => {
    const onDensityChange = vi.fn()
    const user = userEvent.setup()

    render(
      <TablePreferences {...defaultProps} onDensityChange={onDensityChange} />,
    )

    await user.click(
      screen.getByRole('button', { name: /table preferences/i }),
    )

    await user.click(screen.getByText('Compact'))

    expect(onDensityChange).toHaveBeenCalledWith('compact')
  })

  it('shows page size options', async () => {
    const user = userEvent.setup()
    render(<TablePreferences {...defaultProps} />)

    await user.click(
      screen.getByRole('button', { name: /table preferences/i }),
    )

    expect(screen.getByText('10')).toBeInTheDocument()
    expect(screen.getByText('25')).toBeInTheDocument()
    expect(screen.getByText('50')).toBeInTheDocument()
    expect(screen.getByText('100')).toBeInTheDocument()
  })

  it('calls onPageSizeChange when page size option clicked', async () => {
    const onPageSizeChange = vi.fn()
    const user = userEvent.setup()

    render(
      <TablePreferences
        {...defaultProps}
        onPageSizeChange={onPageSizeChange}
      />,
    )

    await user.click(
      screen.getByRole('button', { name: /table preferences/i }),
    )

    await user.click(screen.getByText('50'))

    expect(onPageSizeChange).toHaveBeenCalledWith(50)
  })
})
