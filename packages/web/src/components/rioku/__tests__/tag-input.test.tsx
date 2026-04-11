import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TagInput } from '../tag-input'

describe('TagInput', () => {
  it('renders existing tags', () => {
    render(
      <TagInput
        value={['X-Forwarded-For', 'X-Real-IP']}
        onChange={vi.fn()}
        label="Client IP Headers"
      />,
    )
    expect(screen.getByText('X-Forwarded-For')).toBeInTheDocument()
    expect(screen.getByText('X-Real-IP')).toBeInTheDocument()
  })

  it('adds a tag when Enter is pressed', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()

    render(
      <TagInput value={[]} onChange={onChange} label="Headers" />,
    )

    const input = screen.getByRole('textbox')
    await user.type(input, 'X-Custom-Header{enter}')
    expect(onChange).toHaveBeenCalledWith(['X-Custom-Header'])
  })

  it('removes a tag when remove button is clicked', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()

    render(
      <TagInput
        value={['tag-a', 'tag-b']}
        onChange={onChange}
        label="Tags"
      />,
    )

    const removeButtons = screen.getAllByRole('button', { name: /remove/i })
    await user.click(removeButtons[0])
    expect(onChange).toHaveBeenCalledWith(['tag-b'])
  })

  it('does not add duplicate tags', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()

    render(
      <TagInput value={['existing']} onChange={onChange} label="Tags" />,
    )

    const input = screen.getByRole('textbox')
    await user.type(input, 'existing{enter}')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not add empty tags', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()

    render(
      <TagInput value={[]} onChange={onChange} label="Tags" />,
    )

    const input = screen.getByRole('textbox')
    await user.type(input, '   {enter}')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('renders as disabled', () => {
    render(
      <TagInput value={['tag']} onChange={vi.fn()} label="Tags" disabled />,
    )

    expect(screen.getByRole('textbox')).toBeDisabled()
  })

  it('shows placeholder text', () => {
    render(
      <TagInput
        value={[]}
        onChange={vi.fn()}
        label="Tags"
        placeholder="Add a CIDR range..."
      />,
    )

    expect(screen.getByPlaceholderText('Add a CIDR range...')).toBeInTheDocument()
  })
})
