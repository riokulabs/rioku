import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProgressBar } from '../progress-bar'

describe('ProgressBar', () => {
  it('renders with correct percentage', () => {
    render(<ProgressBar value={75} max={100} label="Storage" />)
    expect(screen.getByText('75%')).toBeInTheDocument()
    expect(screen.getByText('Storage')).toBeInTheDocument()
  })

  it('renders formatted byte values', () => {
    render(
      <ProgressBar
        value={536870912}
        max={1073741824}
        label="Trace storage"
        formatValue={(v) => `${(v / 1073741824).toFixed(1)} GB`}
      />,
    )
    expect(screen.getByText('0.5 GB')).toBeInTheDocument()
    expect(screen.getByText('1.0 GB')).toBeInTheDocument()
  })

  it('renders with warning color when above threshold', () => {
    const { container } = render(
      <ProgressBar value={90} max={100} label="Storage" warningThreshold={80} />
    )
    const bar = container.querySelector('[data-slot="progress-fill"]')
    expect(bar?.className).toContain('bg-amber')
  })

  it('renders with danger color when above danger threshold', () => {
    const { container } = render(
      <ProgressBar value={96} max={100} label="Storage" dangerThreshold={95} />
    )
    const bar = container.querySelector('[data-slot="progress-fill"]')
    expect(bar?.className).toContain('bg-red')
  })

  it('handles zero max gracefully', () => {
    render(<ProgressBar value={0} max={0} label="Empty" />)
    expect(screen.getByText('0%')).toBeInTheDocument()
  })

  it('has correct aria attributes', () => {
    render(<ProgressBar value={50} max={100} label="Storage" />)
    const progressbar = screen.getByRole('progressbar')
    expect(progressbar).toHaveAttribute('aria-valuenow', '50')
    expect(progressbar).toHaveAttribute('aria-valuemin', '0')
    expect(progressbar).toHaveAttribute('aria-valuemax', '100')
  })
})
