import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TypeSelectorTiles } from '../type-selector-tiles'

const options = [
  { value: 'rate', label: 'Rate Limit', description: 'Limit rates', icon: <span>R</span> },
  { value: 'cors', label: 'CORS', description: 'CORS rules', icon: <span>C</span> },
]

describe('TypeSelectorTiles', () => {
  it('renders a tile for each option with label and description', () => {
    render(<TypeSelectorTiles options={options} value={null} onChange={vi.fn()} />)
    expect(screen.getByText('Rate Limit')).toBeInTheDocument()
    expect(screen.getByText('Limit rates')).toBeInTheDocument()
    expect(screen.getByText('CORS')).toBeInTheDocument()
  })

  it('highlights the selected tile with aria-selected', () => {
    render(<TypeSelectorTiles options={options} value="rate" onChange={vi.fn()} />)
    const radios = screen.getAllByRole('radio')
    expect(radios[0]).toHaveAttribute('aria-selected', 'true')
    expect(radios[1]).toHaveAttribute('aria-selected', 'false')
  })

  it('calls onChange when a tile is clicked', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<TypeSelectorTiles options={options} value={null} onChange={onChange} />)
    await user.click(screen.getByText('CORS'))
    expect(onChange).toHaveBeenCalledWith('cors')
  })

  it('applies aria-checked to the active tile', () => {
    render(<TypeSelectorTiles options={options} value="cors" onChange={vi.fn()} />)
    const radios = screen.getAllByRole('radio')
    expect(radios[0]).toHaveAttribute('aria-checked', 'false')
    expect(radios[1]).toHaveAttribute('aria-checked', 'true')
  })
})
