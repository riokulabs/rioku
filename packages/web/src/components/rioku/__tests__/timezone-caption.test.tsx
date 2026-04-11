import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TimezoneCaption } from '../timezone-caption'

describe('TimezoneCaption', () => {
  it('renders UTC timezone caption', () => {
    render(<TimezoneCaption />)
    expect(screen.getByText(/times shown in utc/i)).toBeInTheDocument()
  })

  it('accepts a custom timezone label', () => {
    render(<TimezoneCaption timezone="America/New_York" />)
    expect(screen.getByText(/times shown in america\/new_york/i)).toBeInTheDocument()
  })
})
