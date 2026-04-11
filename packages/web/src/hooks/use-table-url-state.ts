import { useState, useCallback, useMemo } from 'react'

interface TableUrlState {
  page: number
  sort: string | null
  sortDir: 'asc' | 'desc'
  search: string
  filters: Record<string, string[]>
}

interface UseTableUrlStateOptions {
  enabled?: boolean
}

interface UseTableUrlStateReturn {
  state: TableUrlState
  setPage: (page: number) => void
  setSort: (key: string | null, dir?: 'asc' | 'desc') => void
  setSearch: (search: string) => void
  setFilter: (key: string, values: string[]) => void
  clearFilters: () => void
}

function parseUrlParams(): Partial<TableUrlState> {
  if (typeof window === 'undefined') return {}
  const params = new URLSearchParams(window.location.search)

  const result: Partial<TableUrlState> = {}

  const page = params.get('page')
  if (page != null) {
    const parsed = parseInt(page, 10)
    if (!isNaN(parsed) && parsed >= 0) result.page = parsed
  }

  const sort = params.get('sort')
  if (sort != null) result.sort = sort

  const sortDir = params.get('sortDir')
  if (sortDir === 'asc' || sortDir === 'desc') result.sortDir = sortDir

  const search = params.get('q')
  if (search != null) result.search = search

  // Parse filters: filter.status=active,inactive
  const filters: Record<string, string[]> = {}
  params.forEach((value, key) => {
    if (key.startsWith('filter.')) {
      const filterKey = key.slice('filter.'.length)
      if (filterKey) {
        filters[filterKey] = value.split(',').filter(Boolean)
      }
    }
  })
  if (Object.keys(filters).length > 0) result.filters = filters

  return result
}

function updateUrlParams(state: TableUrlState) {
  if (typeof window === 'undefined') return
  const params = new URLSearchParams(window.location.search)

  // Page
  if (state.page > 0) {
    params.set('page', String(state.page))
  } else {
    params.delete('page')
  }

  // Sort
  if (state.sort) {
    params.set('sort', state.sort)
    params.set('sortDir', state.sortDir)
  } else {
    params.delete('sort')
    params.delete('sortDir')
  }

  // Search
  if (state.search) {
    params.set('q', state.search)
  } else {
    params.delete('q')
  }

  // Remove old filters
  const keysToDelete: string[] = []
  params.forEach((_value, key) => {
    if (key.startsWith('filter.')) keysToDelete.push(key)
  })
  for (const key of keysToDelete) {
    params.delete(key)
  }

  // Set new filters
  for (const [key, values] of Object.entries(state.filters)) {
    if (values.length > 0) {
      params.set(`filter.${key}`, values.join(','))
    }
  }

  const search = params.toString()
  const url = search ? `${window.location.pathname}?${search}` : window.location.pathname
  window.history.replaceState(null, '', url)
}

const defaultState: TableUrlState = {
  page: 0,
  sort: null,
  sortDir: 'asc',
  search: '',
  filters: {},
}

function useTableUrlState(options: UseTableUrlStateOptions = {}): UseTableUrlStateReturn {
  const { enabled = true } = options

  const initialState = useMemo(() => {
    if (!enabled) return defaultState
    const fromUrl = parseUrlParams()
    return { ...defaultState, ...fromUrl }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const [state, setState] = useState<TableUrlState>(initialState)

  const syncUrl = useCallback(
    (newState: TableUrlState) => {
      if (enabled) {
        updateUrlParams(newState)
      }
    },
    [enabled],
  )

  const setPage = useCallback(
    (page: number) => {
      setState((prev) => {
        const next = { ...prev, page }
        syncUrl(next)
        return next
      })
    },
    [syncUrl],
  )

  const setSort = useCallback(
    (key: string | null, dir: 'asc' | 'desc' = 'asc') => {
      setState((prev) => {
        const next = { ...prev, sort: key, sortDir: dir, page: 0 }
        syncUrl(next)
        return next
      })
    },
    [syncUrl],
  )

  const setSearch = useCallback(
    (search: string) => {
      setState((prev) => {
        const next = { ...prev, search, page: 0 }
        syncUrl(next)
        return next
      })
    },
    [syncUrl],
  )

  const setFilter = useCallback(
    (key: string, values: string[]) => {
      setState((prev) => {
        const next = {
          ...prev,
          filters: { ...prev.filters, [key]: values },
          page: 0,
        }
        syncUrl(next)
        return next
      })
    },
    [syncUrl],
  )

  const clearFilters = useCallback(() => {
    setState((prev) => {
      const next = { ...prev, filters: {}, page: 0 }
      syncUrl(next)
      return next
    })
  }, [syncUrl])

  return { state, setPage, setSort, setSearch, setFilter, clearFilters }
}

export { useTableUrlState }
export type { TableUrlState, UseTableUrlStateOptions, UseTableUrlStateReturn }
