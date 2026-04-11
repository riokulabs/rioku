import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SearchableMultiSelect, SearchableSelect } from '../searchable-select'
import type { SelectOption } from '../searchable-select'

const options: SelectOption[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'editor', label: 'Editor' },
  { value: 'viewer', label: 'Viewer' },
  { value: 'moderator', label: 'Moderator' },
]

describe('SearchableSelect', () => {
  it('renders with placeholder text', () => {
    render(
      <SearchableSelect
        options={options}
        value=""
        onChange={() => {}}
        placeholder="Select a role..."
      />,
    )

    const input = screen.getByPlaceholderText('Select a role...')
    expect(input).toBeInTheDocument()
  })

  it('filters options on typing', async () => {
    const user = userEvent.setup()

    render(
      <SearchableSelect options={options} value="" onChange={() => {}} />,
    )

    const input = screen.getByRole('combobox')
    await user.click(input)
    await user.type(input, 'ed')

    // "Editor" should be visible, others should be filtered out
    const listbox = screen.getByRole('listbox')
    const visibleOptions = within(listbox).getAllByRole('option')
    expect(visibleOptions).toHaveLength(1)
    expect(visibleOptions[0]).toHaveTextContent('Editor')
  })

  it('calls onChange when an option is selected', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <SearchableSelect options={options} value="" onChange={onChange} />,
    )

    const input = screen.getByRole('combobox')
    await user.click(input)

    const listbox = screen.getByRole('listbox')
    const option = within(listbox).getByText('Admin')
    await user.click(option)

    expect(onChange).toHaveBeenCalledWith('admin')
  })

  it('supports keyboard navigation (ArrowDown, Enter)', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <SearchableSelect options={options} value="" onChange={onChange} />,
    )

    const input = screen.getByRole('combobox')
    await user.click(input)

    // Arrow down to highlight first option, then press Enter
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')

    expect(onChange).toHaveBeenCalledWith('admin')
  })

  it('closes dropdown on Escape', async () => {
    const user = userEvent.setup()

    render(
      <SearchableSelect options={options} value="" onChange={() => {}} />,
    )

    const input = screen.getByRole('combobox')
    await user.click(input)

    // Dropdown should be open
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    // Dropdown should be closed
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('displays selected value as inline text', () => {
    render(
      <SearchableSelect
        options={options}
        value="editor"
        onChange={() => {}}
      />,
    )

    const input = screen.getByRole('combobox') as HTMLInputElement
    expect(input.value).toBe('Editor')
  })
})

describe('SearchableMultiSelect', () => {
  it('renders selected items as removable badges', () => {
    render(
      <SearchableMultiSelect
        options={options}
        value={['admin', 'editor']}
        onChange={() => {}}
      />,
    )

    expect(screen.getByText('Admin')).toBeInTheDocument()
    expect(screen.getByText('Editor')).toBeInTheDocument()

    // Each badge should have a remove button
    const removeButtons = screen.getAllByRole('button', { name: /remove/i })
    expect(removeButtons).toHaveLength(2)
  })

  it('adds an option to selection', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <SearchableMultiSelect
        options={options}
        value={['admin']}
        onChange={onChange}
      />,
    )

    const input = screen.getByRole('combobox')
    await user.click(input)

    const listbox = screen.getByRole('listbox')
    const option = within(listbox).getByText('Editor')
    await user.click(option)

    expect(onChange).toHaveBeenCalledWith(['admin', 'editor'])
  })

  it('removes a badge on click', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <SearchableMultiSelect
        options={options}
        value={['admin', 'editor']}
        onChange={onChange}
      />,
    )

    const removeButtons = screen.getAllByRole('button', { name: /remove/i })
    // Remove "Admin" badge (first one)
    await user.click(removeButtons[0])

    expect(onChange).toHaveBeenCalledWith(['editor'])
  })

  it('does not show already-selected options in dropdown', async () => {
    const user = userEvent.setup()

    render(
      <SearchableMultiSelect
        options={options}
        value={['admin', 'editor']}
        onChange={() => {}}
      />,
    )

    const input = screen.getByRole('combobox')
    await user.click(input)

    const listbox = screen.getByRole('listbox')
    const visibleOptions = within(listbox).getAllByRole('option')

    // Only Viewer and Moderator should be visible (Admin and Editor already selected)
    expect(visibleOptions).toHaveLength(2)
    expect(within(listbox).queryByText('Admin')).not.toBeInTheDocument()
    expect(within(listbox).queryByText('Editor')).not.toBeInTheDocument()
    expect(within(listbox).getByText('Viewer')).toBeInTheDocument()
    expect(within(listbox).getByText('Moderator')).toBeInTheDocument()
  })
})
