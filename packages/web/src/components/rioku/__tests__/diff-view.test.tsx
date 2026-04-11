import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DiffView } from '../diff-view'

describe('DiffView', () => {
  it('renders changed fields with old and new values', () => {
    const changes = [
      { field: 'Name', oldValue: 'old-route', newValue: 'new-route' },
      { field: 'Enabled', oldValue: 'true', newValue: 'false' },
    ]
    render(<DiffView changes={changes} />)
    expect(screen.getByText('Name')).toBeInTheDocument()
    expect(screen.getByText('old-route')).toBeInTheDocument()
    expect(screen.getByText('new-route')).toBeInTheDocument()
    expect(screen.getByText('Enabled')).toBeInTheDocument()
  })

  it('renders empty state when no changes', () => {
    render(<DiffView changes={[]} />)
    expect(screen.getByText('No changes detected')).toBeInTheDocument()
  })

  it('renders added items with green indicator', () => {
    const changes = [
      { field: 'Host matcher', oldValue: null, newValue: 'api.example.com' },
    ]
    render(<DiffView changes={changes} />)
    expect(screen.getByText('api.example.com')).toBeInTheDocument()
    expect(screen.getByTestId('diff-added')).toBeInTheDocument()
  })

  it('renders removed items with red indicator', () => {
    const changes = [
      { field: 'Policy', oldValue: 'rate-limit', newValue: null },
    ]
    render(<DiffView changes={changes} />)
    expect(screen.getByText('rate-limit')).toBeInTheDocument()
    expect(screen.getByTestId('diff-removed')).toBeInTheDocument()
  })
})
