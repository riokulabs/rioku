import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api'
import type { ConfigSnapshot, UserInfo, ApiKey } from '@/lib/api'

export interface EntitySearchResult {
  type: 'route' | 'service' | 'policy' | 'user' | 'apiKey'
  id: string
  name: string
  subtitle: string
  path: string
}

const MAX_PER_CATEGORY = 5

function matches(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase())
}

export function useEntitySearch(query: string) {
  const trimmed = query.trim()

  const configQuery = useQuery<ConfigSnapshot>({
    queryKey: ['config'],
    queryFn: () => apiClient.get<ConfigSnapshot>('/config'),
    staleTime: 30_000,
    enabled: trimmed.length > 0,
  })

  const usersQuery = useQuery<UserInfo[]>({
    queryKey: ['auth', 'users'],
    queryFn: () => apiClient.get<UserInfo[]>('/auth/users'),
    staleTime: 30_000,
    enabled: trimmed.length > 0,
  })

  const keysQuery = useQuery<ApiKey[]>({
    queryKey: ['keys'],
    queryFn: () => apiClient.get<ApiKey[]>('/keys'),
    staleTime: 30_000,
    enabled: trimmed.length > 0,
  })

  const isLoading = configQuery.isLoading || usersQuery.isLoading || keysQuery.isLoading

  const results = useMemo(() => {
    if (!trimmed) return []

    const items: EntitySearchResult[] = []

    // Routes
    if (configQuery.data) {
      const routeResults = configQuery.data.routes
        .filter((r) => {
          const hosts = r.matchers.flatMap((m) => m.hosts ?? [])
          return matches(r.name, trimmed) || hosts.some((h) => matches(h, trimmed))
        })
        .slice(0, MAX_PER_CATEGORY)
        .map((r): EntitySearchResult => {
          const hosts = r.matchers.flatMap((m) => m.hosts ?? [])
          return {
            type: 'route',
            id: r.id,
            name: r.name,
            subtitle: hosts.length > 0 ? hosts[0] : 'No host',
            path: `/config/routes/${r.id}`,
          }
        })
      items.push(...routeResults)
    }

    // Services
    if (configQuery.data) {
      const serviceResults = configQuery.data.services
        .filter((s) => matches(s.name, trimmed))
        .slice(0, MAX_PER_CATEGORY)
        .map((s): EntitySearchResult => ({
          type: 'service',
          id: s.id,
          name: s.name,
          subtitle: `${s.upstreams.length} upstream${s.upstreams.length !== 1 ? 's' : ''}`,
          path: `/config/services/${s.id}`,
        }))
      items.push(...serviceResults)
    }

    // Policies
    if (configQuery.data) {
      const policyResults = configQuery.data.policies
        .filter((p) => matches(p.name, trimmed) || matches(p.type, trimmed))
        .slice(0, MAX_PER_CATEGORY)
        .map((p): EntitySearchResult => {
          const typeLabel = p.type
            .replace('POLICY_TYPE_', '')
            .replace(/_/g, ' ')
            .toLowerCase()
            .replace(/\b\w/g, (c) => c.toUpperCase())
          return {
            type: 'policy',
            id: p.id,
            name: p.name,
            subtitle: typeLabel,
            path: `/config/policies/${p.id}`,
          }
        })
      items.push(...policyResults)
    }

    // Users
    if (usersQuery.data) {
      const userResults = usersQuery.data
        .filter((u) =>
          matches(u.username, trimmed) ||
          (u.email && matches(u.email, trimmed)) ||
          (u.displayName && matches(u.displayName, trimmed))
        )
        .slice(0, MAX_PER_CATEGORY)
        .map((u): EntitySearchResult => ({
          type: 'user',
          id: u.id,
          name: u.displayName ?? u.username,
          subtitle: u.email ?? u.username,
          path: `/security/users/${u.id}`,
        }))
      items.push(...userResults)
    }

    // API Keys
    if (keysQuery.data) {
      const keyResults = keysQuery.data
        .filter((k) => matches(k.name, trimmed) || matches(k.prefix, trimmed))
        .slice(0, MAX_PER_CATEGORY)
        .map((k): EntitySearchResult => ({
          type: 'apiKey',
          id: k.id,
          name: k.name,
          subtitle: `${k.prefix}...`,
          path: `/security/keys/${k.id}`,
        }))
      items.push(...keyResults)
    }

    return items
  }, [trimmed, configQuery.data, usersQuery.data, keysQuery.data])

  return { results, isLoading }
}
