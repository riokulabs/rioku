import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

interface ErrorBoundaryProps {
  fallback?: ReactNode
  onError?: (error: Error, errorInfo: ErrorInfo) => void
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.props.onError?.(error, errorInfo)
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null })
  }

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children
    }

    if (this.props.fallback) {
      return this.props.fallback
    }

    return (
      <div
        role="alert"
        className="flex min-h-[200px] items-center justify-center p-6"
        data-testid="error-boundary-fallback"
      >
        <div className="w-full max-w-sm space-y-4 text-center">
          <h2 className="text-lg font-semibold text-foreground">
            Something went wrong
          </h2>
          {import.meta.env.DEV && this.state.error && (
            <p
              className="text-sm text-muted-foreground break-words"
              data-testid="error-boundary-message"
            >
              {this.state.error.message}
            </p>
          )}
          <Button variant="outline" onClick={this.handleReset}>
            Retry
          </Button>
        </div>
      </div>
    )
  }
}

export { ErrorBoundary }
export type { ErrorBoundaryProps }
