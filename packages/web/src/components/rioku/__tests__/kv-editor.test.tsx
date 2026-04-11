import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('lucide-react', () => ({
  PlusIcon: () => <span>+</span>,
  TrashIcon: () => <span>x</span>,
}))

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.ComponentProps<'input'>) => <input {...props} />,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, ...props }: React.ComponentProps<'button'>) => (
    <button onClick={onClick} {...props}>{children}</button>
  ),
}))

import { KvEditor } from '../kv-editor'

describe('KvEditor', () => {
  it('renders existing key-value pairs as rows', () => {
    render(<KvEditor value={[{ key: 'foo', value: 'bar' }]} onChange={vi.fn()} />)
    const inputs = screen.getAllByRole('textbox')
    expect(inputs[0]).toHaveValue('foo')
    expect(inputs[1]).toHaveValue('bar')
  })

  it('adds a new empty row when Add button clicked', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<KvEditor value={[]} onChange={onChange} />)
    await user.click(screen.getByText('Add'))
    expect(onChange).toHaveBeenCalledWith([{ key: '', value: '' }])
  })

  it('removes a row when delete button clicked', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<KvEditor value={[{ key: 'a', value: 'b' }, { key: 'c', value: 'd' }]} onChange={onChange} />)
    const removeButtons = screen.getAllByRole('button', { name: /remove/i })
    await user.click(removeButtons[0])
    expect(onChange).toHaveBeenCalledWith([{ key: 'c', value: 'd' }])
  })

  it('calls onChange with updated pairs when input changes', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<KvEditor value={[{ key: '', value: '' }]} onChange={onChange} />)
    const inputs = screen.getAllByRole('textbox')
    await user.type(inputs[0], 'key1')
    expect(onChange).toHaveBeenCalled()
  })
})
