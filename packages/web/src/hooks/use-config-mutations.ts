import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api'
import type { Route, ConfigSnapshot } from '@/lib/api'

/**
 * Shared route mutations: save (UPSERT), delete, toggle enable/disable.
 * Toggle and delete use optimistic updates for instant UI feedback.
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
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['config'] })
      const previous = queryClient.getQueryData<ConfigSnapshot>(['config'])
      queryClient.setQueryData<ConfigSnapshot>(['config'], (old) => {
        if (!old) return old
        return { ...old, routes: old.routes.filter((r) => r.id !== id) }
      })
      return { previous }
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['config'], context.previous)
      }
      toast.error('Failed to delete route')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] })
    },
    onSuccess: () => {
      toast.success('Route deleted')
    },
  })

  const toggleMutation = useMutation({
    mutationFn: (route: Pick<Route, 'id' | 'enabled'>) =>
      apiClient.post('/config', {
        route: { action: 'UPSERT', route: { id: route.id, enabled: !route.enabled } },
      }),
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: ['config'] })
      const previous = queryClient.getQueryData<ConfigSnapshot>(['config'])
      queryClient.setQueryData<ConfigSnapshot>(['config'], (old) => {
        if (!old) return old
        return {
          ...old,
          routes: old.routes.map((r) =>
            r.id === variables.id ? { ...r, enabled: !variables.enabled } : r,
          ),
        }
      })
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['config'], context.previous)
      }
      toast.error('Failed to toggle route')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] })
    },
    onSuccess: (_data, variables) => {
      toast.success(variables.enabled ? 'Route disabled' : 'Route enabled')
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
 * Delete uses optimistic updates for instant UI feedback.
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
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['config'] })
      const previous = queryClient.getQueryData<ConfigSnapshot>(['config'])
      queryClient.setQueryData<ConfigSnapshot>(['config'], (old) => {
        if (!old) return old
        return { ...old, services: old.services.filter((s) => s.id !== id) }
      })
      return { previous }
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['config'], context.previous)
      }
      toast.error('Failed to delete service')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] })
    },
    onSuccess: () => {
      toast.success('Service deleted')
    },
  })

  return { saveMutation, deleteMutation }
}
