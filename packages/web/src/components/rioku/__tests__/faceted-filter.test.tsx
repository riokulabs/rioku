import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FacetedFilter, type FilterColumn } from '../faceted-filter'

const statusColumn: FilterColumn = {
  key: 'status',
  label: 'Status',
  options: [
    { label: 'Active', value: 'active' },
    { label: 'Inactive', value: 'inactive' },
    { label: 'Pending', value: 'pending' },
  ],
}

describe('FacetedFilter', () => {
  it('renders button with label', () => {
    render(
      <FacetedFilter
        column={statusColumn}
        selected={[]}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByText('Status')).toBeInTheDocument()
  })

  it('opens popover on click', async () => {
    const user = userEvent.setup()

    render(
      <FacetedFilter
        column={statusColumn}
        selected={[]}
        onChange={vi.fn()}
      />,
    )

    await user.click(screen.getByText('Status'))

    // All options should be visible in the popover
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('Inactive')).toBeInTheDocument()
    expect(screen.getByText('Pending')).toBeInTheDocument()
  })

  it('shows all options as checkboxes', async () => {
    const user = userEvent.setup()

    render(
      <FacetedFilter
        column={statusColumn}
        selected={[]}
        onChange={vi.fn()}
      />,
    )

    await user.click(screen.getByText('Status'))

    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(3)
  })

  it('calls onChange when option toggled', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()

    render(
      <FacetedFilter
        column={statusColumn}
        selected={[]}
        onChange={onChange}
      />,
    )

    await user.click(screen.getByText('Status'))
    await user.click(screen.getByText('Active'))

    expect(onChange).toHaveBeenCalledWith(['active'])
  })

  it('removes value when already selected', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()

    render(
      <FacetedFilter
        column={statusColumn}
        selected={['active']}
        onChange={onChange}
      />,
    )

    await user.click(screen.getByText('Status'))
    await user.click(screen.getByText('Active'))

    expect(onChange).toHaveBeenCalledWith([])
  })

  it('shows count badge when items selected', () => {
    render(
      <FacetedFilter
        column={statusColumn}
        selected={['active', 'inactive']}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('shows clear filter button when items selected', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()

    render(
      <FacetedFilter
        column={statusColumn}
        selected={['active']}
        onChange={onChange}
      />,
    )

    await user.click(screen.getByText('Status'))
    await user.click(screen.getByText('Clear filter'))

    expect(onChange).toHaveBeenCalledWith([])
  })
})
