import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TimeRangeSelector } from '@/components/rioku/time-range-selector'

describe('TimeRangeSelector', () => {
  it('renders all range options as buttons', () => {
    render(<TimeRangeSelector range="24h" onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: '1h' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '6h' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '24h' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '7d' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '30d' })).toBeInTheDocument()
  })

  it('highlights the active range', () => {
    render(<TimeRangeSelector range="7d" onChange={vi.fn()} />)
    const btn = screen.getByRole('button', { name: '7d' })
    expect(btn.className).toContain('bg-primary')
  })

  it('calls onChange when a different range is clicked', () => {
    const onChange = vi.fn()
    render(<TimeRangeSelector range="24h" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: '1h' }))
    expect(onChange).toHaveBeenCalledWith('1h')
  })
})
