import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Sparkline } from '../sparkline'

describe('Sparkline', () => {
  it('renders SVG with correct dimensions', () => {
    const { container } = render(
      <Sparkline data={[1, 2, 3, 4, 5]} width={100} height={30} />,
    )

    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('width', '100')
    expect(svg).toHaveAttribute('height', '30')
  })

  it('uses default dimensions when not specified', () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} />)

    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('width', '80')
    expect(svg).toHaveAttribute('height', '24')
  })

  it('renders polyline with computed points', () => {
    const { container } = render(<Sparkline data={[0, 10, 5]} />)

    const polyline = container.querySelector('polyline')
    expect(polyline).toBeInTheDocument()
    expect(polyline?.getAttribute('points')).toBeTruthy()
    // Points string should contain comma-separated x,y pairs
    expect(polyline?.getAttribute('points')).toMatch(/\d+\.?\d*,\d+\.?\d*/)
  })

  it('applies color prop to stroke', () => {
    const { container } = render(
      <Sparkline data={[1, 2, 3]} color="#ff0000" />,
    )

    const polyline = container.querySelector('polyline')
    expect(polyline).toHaveAttribute('stroke', '#ff0000')
  })

  it('uses currentColor as default stroke', () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} />)

    const polyline = container.querySelector('polyline')
    expect(polyline).toHaveAttribute('stroke', 'currentColor')
  })

  it('returns null for data with fewer than 2 points', () => {
    const { container } = render(<Sparkline data={[1]} />)

    expect(container.querySelector('svg')).not.toBeInTheDocument()
  })

  it('returns null for empty data', () => {
    const { container } = render(<Sparkline data={[]} />)

    expect(container.querySelector('svg')).not.toBeInTheDocument()
  })

  it('handles data where all values are the same', () => {
    const { container } = render(<Sparkline data={[5, 5, 5]} />)

    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    // Should not crash -- range=0 is handled (fallback to 1)
  })
})
