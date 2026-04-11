import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('lucide-react', () => ({
  XIcon: () => <span data-testid="x-icon">x</span>,
}))

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.ComponentProps<'input'>) => <input {...props} />,
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children, ...props }: { children: React.ReactNode }) => <span data-testid="tag-badge" {...props}>{children}</span>,
}))

import { TagInput } from '../tag-input'

describe('TagInput', () => {
  it('renders existing tags as badges', () => {
    render(<TagInput value={['tag1', 'tag2']} onChange={vi.fn()} />)
    const badges = screen.getAllByTestId('tag-badge')
    expect(badges).toHaveLength(2)
    expect(badges[0]).toHaveTextContent('tag1')
  })

  it('adds tag when Enter pressed', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<TagInput value={[]} onChange={onChange} placeholder="Add tag" />)
    const input = screen.getByPlaceholderText('Add tag')
    await user.type(input, 'newtag{Enter}')
    expect(onChange).toHaveBeenCalledWith(['newtag'])
  })

  it('removes tag when remove button clicked', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<TagInput value={['tag1', 'tag2']} onChange={onChange} />)
    const removeButtons = screen.getAllByRole('button', { name: /remove/i })
    await user.click(removeButtons[0])
    expect(onChange).toHaveBeenCalledWith(['tag2'])
  })

  it('prevents duplicate tags', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<TagInput value={['existing']} onChange={onChange} />)
    const input = screen.getByRole('textbox')
    await user.type(input, 'existing{Enter}')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('calls onChange with updated array', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<TagInput value={['a']} onChange={onChange} placeholder="Add" />)
    const input = screen.getByPlaceholderText('')  // placeholder hidden when tags exist
    await user.type(input, 'b{Enter}')
    expect(onChange).toHaveBeenCalledWith(['a', 'b'])
  })
})
