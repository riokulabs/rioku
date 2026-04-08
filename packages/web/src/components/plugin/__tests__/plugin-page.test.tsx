import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PluginPage } from '../plugin-page'

describe('PluginPage', () => {
  it('renders children normally', () => {
    render(
      <PluginPage pluginId="my-plugin">
        <div>Plugin Content</div>
      </PluginPage>,
    )

    expect(screen.getByText('Plugin Content')).toBeInTheDocument()
  })

  it('displays plugin ID badge', () => {
    render(
      <PluginPage pluginId="my-plugin">
        <div>Content</div>
      </PluginPage>,
    )

    expect(screen.getByText('my-plugin')).toBeInTheDocument()
  })

  it('catches child errors and shows error UI with plugin ID', () => {
    // Suppress React error boundary console output
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    function ThrowingComponent(): JSX.Element {
      throw new Error('Test crash')
    }

    render(
      <PluginPage pluginId="broken-plugin">
        <ThrowingComponent />
      </PluginPage>,
    )

    expect(screen.getByText('Plugin Error')).toBeInTheDocument()
    expect(screen.getByText(/broken-plugin/)).toBeInTheDocument()
    expect(screen.getByText('Test crash')).toBeInTheDocument()

    consoleSpy.mockRestore()
  })
})
