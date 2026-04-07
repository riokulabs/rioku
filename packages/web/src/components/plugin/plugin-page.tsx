import { Component, type ErrorInfo, type ReactNode } from 'react'

interface PluginPageProps {
  pluginId: string
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

class PluginErrorBoundary extends Component<
  { pluginId: string; children: ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { pluginId: string; children: ReactNode }) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      `[rioku] Plugin "${this.props.pluginId}" crashed:`,
      error,
      info.componentStack,
    )
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-8 text-center">
          <h3 className="text-sm font-medium text-destructive">
            Plugin Error
          </h3>
          <p className="max-w-md text-sm text-muted-foreground">
            The plugin <strong>{this.props.pluginId}</strong> encountered an
            error and could not render.
          </p>
          {this.state.error && (
            <pre className="mt-2 max-w-lg overflow-auto rounded bg-muted p-2 text-xs text-muted-foreground">
              {this.state.error.message}
            </pre>
          )}
        </div>
      )
    }

    return this.props.children
  }
}

function PluginPage({ pluginId, children }: PluginPageProps) {
  return (
    <PluginErrorBoundary pluginId={pluginId}>
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono">
            {pluginId}
          </span>
        </div>
        {children}
      </div>
    </PluginErrorBoundary>
  )
}

export { PluginPage }
export type { PluginPageProps }
