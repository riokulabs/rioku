/**
 * Route-level error boundary for the Rioku admin panel.
 *
 * Used as TanStack Router's `errorComponent` on the root route, so any
 * unhandled render-time error surfaces this UI instead of a blank screen.
 *
 * Logs errors to console.error only (no remote reporting).
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorState } from '@/components/error-state';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  caught: Error | null;
  correlationId: string | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { caught: null, correlationId: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      caught: error,
      correlationId: `err-${Date.now().toString(36)}`,
    };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Unhandled render error', error, info.componentStack);
  }

  handleRetry = () => {
    window.location.reload();
  };

  override render() {
    if (this.state.caught) {
      return (
        <ErrorState
          title="Something went wrong"
          description={this.state.caught.message}
          {...(this.state.correlationId ? { correlationId: this.state.correlationId } : {})}
          retry={this.handleRetry}
        />
      );
    }
    return this.props.children;
  }
}

/**
 * TanStack Router errorComponent-compatible fallback.
 *
 * TanStack Router v1 passes `{ error: Error }` to `errorComponent`.
 * This component matches that interface and renders our <ErrorState>.
 *
 * The correlationId is derived from the error message hash so it is stable
 * across re-renders of the same error (avoids the react-hooks/purity lint
 * rule that bans Date.now() in component bodies).
 */
export function ErrorBoundaryFallback({ error }: { error: Error }) {
  // Stable pseudo-ID: hash the first 16 chars of the message.
  const stableId = error.message
    .slice(0, 16)
    .split('')
    .reduce((acc, c) => acc + c.charCodeAt(0), 0)
    .toString(36);
  const correlationId = `err-${stableId}`;

  function handleRetry() {
    window.location.reload();
  }

  return (
    <ErrorState
      title="Something went wrong"
      description={error.message}
      correlationId={correlationId}
      retry={handleRetry}
    />
  );
}
