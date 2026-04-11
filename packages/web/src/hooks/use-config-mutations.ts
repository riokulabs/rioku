import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api'
import type { Route } from '@/lib/api'

/**
 * Shared route mutations: save (UPSERT), delete, toggle enable/disable.
 * Invalidates the config query on success.
 */
export function useRouteMutations() {
  const queryClient = useQueryClient()

  const saveMutation = useMutation({
    mutationFn: (route: Record<string, unknown>) =>
      apiClient.post('/config', { route: { action: 'UPSERT', route } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] })
    },
    onError: () => {
      toast.error('Failed to save route')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.post('/config', { route: { action: 'DELETE', id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] })
      toast.success('Route deleted')
    },
    onError: () => {
      toast.error('Failed to delete route')
    },
  })

  const toggleMutation = useMutation({
    mutationFn: (route: Pick<Route, 'id' | 'enabled'>) =>
      apiClient.post('/config', {
        route: { action: 'UPSERT', route: { id: route.id, enabled: !route.enabled } },
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['config'] })
      toast.success(variables.enabled ? 'Route disabled' : 'Route enabled')
    },
    onError: () => {
      toast.error('Failed to toggle route')
    },
  })

  const duplicateMutation = useMutation({
    mutationFn: (route: Record<string, unknown>) => {
      const { id, ...rest } = route
      return apiClient.post('/config', {
        route: { action: 'UPSERT', route: { ...rest, name: `${rest.name}-copy` } },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] })
      toast.success('Route duplicated')
    },
    onError: () => {
      toast.error('Failed to duplicate route')
    },
  })

  return { saveMutation, deleteMutation, toggleMutation, duplicateMutation }
}

/**
 * Shared service mutations: save (UPSERT), delete.
 */
export function useServiceMutations() {
  const queryClient = useQueryClient()

  const saveMutation = useMutation({
    mutationFn: (service: Record<string, unknown>) =>
      apiClient.post('/config', { service: { action: 'UPSERT', service } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] })
    },
    onError: () => {
      toast.error('Failed to save service')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.post('/config', { service: { action: 'DELETE', id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] })
      toast.success('Service deleted')
    },
    onError: () => {
      toast.error('Failed to delete service')
    },
  })

  return { saveMutation, deleteMutation }
}
