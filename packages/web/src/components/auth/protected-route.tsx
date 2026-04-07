import { type ReactNode } from 'react'
import { Navigate } from '@tanstack/react-router'
import { useAuth } from '@/hooks/use-auth'
import { Skeleton } from '@/components/ui/skeleton'

interface ProtectedRouteProps {
  children: ReactNode
}

function AuthLoadingSkeleton() {
  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-96" />
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="mt-4 h-64" />
    </div>
  )
}

function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated } = useAuth()

  // The auth hook resolves synchronously from the token store,
  // so there is no true "loading" state. If refresh is pending,
  // isAuthenticated starts as false and flips once resolved.
  // We show a skeleton briefly in case the provider is still
  // initializing on first render.
  if (isAuthenticated === undefined) {
    return <AuthLoadingSkeleton />
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" />
  }

  return <>{children}</>
}

export { ProtectedRoute }
export type { ProtectedRouteProps }
