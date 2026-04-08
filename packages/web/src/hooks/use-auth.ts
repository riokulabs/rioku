// Session hook — reads from /auth/me (cookie auth).
// Used by root layout and sidebar to access current user info.

import { useQuery } from '@tanstack/react-query'
import type { MeResponse } from '@/lib/api'

export function useSession() {
  return useQuery<MeResponse>({
    queryKey: ['auth', 'me'],
    queryFn: () =>
      fetch('/api/v1/auth/me', { credentials: 'include' }).then((r) => {
        if (!r.ok) throw new Error('Unauthenticated')
        return r.json() as Promise<MeResponse>
      }),
    staleTime: 60_000,
    retry: false,
  })
}

export function useCurrentUser() {
  const { data } = useSession()
  return data?.user ?? null
}

export function usePermissions() {
  const { data } = useSession()
  return data?.user.permissions ?? []
}

export function useHasPermission(permission: string): boolean {
  const permissions = usePermissions()
  return (
    permissions.includes('*') ||
    permissions.includes(permission) ||
    permissions.some(
      (p) => p.endsWith(':*') && permission.startsWith(p.slice(0, -1)),
    )
  )
}
