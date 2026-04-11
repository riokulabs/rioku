import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SettingsField } from '../settings-field'

describe('SettingsField', () => {
  it('renders children when backend is available', () => {
    render(
      <SettingsField label="Instance name" needsBackend={false}>
        <input data-testid="child-input" />
      </SettingsField>,
    )
    expect(screen.getByTestId('child-input')).toBeInTheDocument()
    expect(screen.queryByText(/requires backend/i)).not.toBeInTheDocument()
  })

  it('renders disabled state with backend notice', () => {
    render(
      <SettingsField label="Trace sampling" needsBackend>
        <input data-testid="child-input" />
      </SettingsField>,
    )
    expect(screen.getByText(/requires backend/i)).toBeInTheDocument()
  })

  it('renders read-only badge for read-only fields', () => {
    render(
      <SettingsField label="Data directory" readOnly>
        <input data-testid="child-input" />
      </SettingsField>,
    )
    expect(screen.getByText(/read-only/i)).toBeInTheDocument()
  })

  it('renders the label', () => {
    render(
      <SettingsField label="Log level" needsBackend={false}>
        <input />
      </SettingsField>,
    )
    expect(screen.getByText('Log level')).toBeInTheDocument()
  })

  it('renders description when provided', () => {
    render(
      <SettingsField
        label="Strict mode"
        description="Reject requests from untrusted proxies"
        needsBackend={false}
      >
        <input />
      </SettingsField>,
    )
    expect(
      screen.getByText('Reject requests from untrusted proxies'),
    ).toBeInTheDocument()
  })
})
