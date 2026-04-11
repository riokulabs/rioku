import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTableUrlState } from '../use-table-url-state'

describe('useTableUrlState', () => {
  beforeEach(() => {
    // Reset URL to clean state
    window.history.replaceState(null, '', '/')
  })

  it('initializes from URL params', () => {
    window.history.replaceState(null, '', '/?page=2&sort=name&sortDir=desc&q=hello&filter.status=active,inactive')

    const { result } = renderHook(() => useTableUrlState({ enabled: true }))

    expect(result.current.state.page).toBe(2)
    expect(result.current.state.sort).toBe('name')
    expect(result.current.state.sortDir).toBe('desc')
    expect(result.current.state.search).toBe('hello')
    expect(result.current.state.filters).toEqual({ status: ['active', 'inactive'] })
  })

  it('defaults when no URL params', () => {
    const { result } = renderHook(() => useTableUrlState({ enabled: true }))

    expect(result.current.state.page).toBe(0)
    expect(result.current.state.sort).toBeNull()
    expect(result.current.state.sortDir).toBe('asc')
    expect(result.current.state.search).toBe('')
    expect(result.current.state.filters).toEqual({})
  })

  it('setSort updates URL', () => {
    const { result } = renderHook(() => useTableUrlState({ enabled: true }))

    act(() => {
      result.current.setSort('name', 'desc')
    })

    expect(result.current.state.sort).toBe('name')
    expect(result.current.state.sortDir).toBe('desc')
    expect(window.location.search).toContain('sort=name')
    expect(window.location.search).toContain('sortDir=desc')
  })

  it('setSearch resets page to 0', () => {
    window.history.replaceState(null, '', '/?page=3')

    const { result } = renderHook(() => useTableUrlState({ enabled: true }))

    expect(result.current.state.page).toBe(3)

    act(() => {
      result.current.setSearch('test')
    })

    expect(result.current.state.page).toBe(0)
    expect(result.current.state.search).toBe('test')
    expect(window.location.search).toContain('q=test')
    expect(window.location.search).not.toContain('page=')
  })

  it('setFilter adds filter to URL', () => {
    const { result } = renderHook(() => useTableUrlState({ enabled: true }))

    act(() => {
      result.current.setFilter('status', ['active', 'inactive'])
    })

    expect(result.current.state.filters.status).toEqual(['active', 'inactive'])
    expect(window.location.search).toContain('filter.status=active%2Cinactive')
  })

  it('clearFilters removes all filters', () => {
    const { result } = renderHook(() => useTableUrlState({ enabled: true }))

    act(() => {
      result.current.setFilter('status', ['active'])
      result.current.setFilter('type', ['http'])
    })

    act(() => {
      result.current.clearFilters()
    })

    expect(result.current.state.filters).toEqual({})
    expect(window.location.search).not.toContain('filter.')
  })

  it('does not sync URL when disabled', () => {
    const { result } = renderHook(() => useTableUrlState({ enabled: false }))

    act(() => {
      result.current.setSort('name', 'asc')
    })

    expect(result.current.state.sort).toBe('name')
    expect(window.location.search).toBe('')
  })

  it('setPage updates page', () => {
    const { result } = renderHook(() => useTableUrlState({ enabled: true }))

    act(() => {
      result.current.setPage(5)
    })

    expect(result.current.state.page).toBe(5)
    expect(window.location.search).toContain('page=5')
  })

  it('removes page param when page is 0', () => {
    const { result } = renderHook(() => useTableUrlState({ enabled: true }))

    act(() => {
      result.current.setPage(3)
    })

    expect(window.location.search).toContain('page=3')

    act(() => {
      result.current.setPage(0)
    })

    expect(window.location.search).not.toContain('page=')
  })
})
