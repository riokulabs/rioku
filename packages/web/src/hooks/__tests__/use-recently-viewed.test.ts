import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRecentlyViewed } from '../use-recently-viewed'

describe('useRecentlyViewed', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns empty array when no items stored', () => {
    const { result } = renderHook(() => useRecentlyViewed())
    expect(result.current.recentItems).toEqual([])
  })

  it('adds and retrieves items', () => {
    const { result } = renderHook(() => useRecentlyViewed())

    act(() => {
      result.current.addRecent({
        type: 'route',
        id: 'route-1',
        name: 'api-v1',
        path: '/config/routes/route-1',
      })
    })

    expect(result.current.recentItems).toHaveLength(1)
    expect(result.current.recentItems[0].name).toBe('api-v1')
  })

  it('deduplicates by id and moves to front', () => {
    const { result } = renderHook(() => useRecentlyViewed())

    act(() => {
      result.current.addRecent({
        type: 'route',
        id: 'route-1',
        name: 'api-v1',
        path: '/config/routes/route-1',
      })
    })

    act(() => {
      result.current.addRecent({
        type: 'service',
        id: 'svc-1',
        name: 'backend',
        path: '/config/services/svc-1',
      })
    })

    act(() => {
      result.current.addRecent({
        type: 'route',
        id: 'route-1',
        name: 'api-v1-updated',
        path: '/config/routes/route-1',
      })
    })

    expect(result.current.recentItems).toHaveLength(2)
    expect(result.current.recentItems[0].id).toBe('route-1')
    expect(result.current.recentItems[0].name).toBe('api-v1-updated')
  })

  it('limits to 10 items', () => {
    const { result } = renderHook(() => useRecentlyViewed())

    for (let i = 0; i < 15; i++) {
      act(() => {
        result.current.addRecent({
          type: 'route',
          id: `route-${i}`,
          name: `route-${i}`,
          path: `/config/routes/route-${i}`,
        })
      })
    }

    expect(result.current.recentItems).toHaveLength(10)
    // Most recent should be first
    expect(result.current.recentItems[0].id).toBe('route-14')
  })

  it('clearRecent empties the list', () => {
    const { result } = renderHook(() => useRecentlyViewed())

    act(() => {
      result.current.addRecent({
        type: 'route',
        id: 'route-1',
        name: 'api-v1',
        path: '/config/routes/route-1',
      })
    })

    expect(result.current.recentItems).toHaveLength(1)

    act(() => {
      result.current.clearRecent()
    })

    expect(result.current.recentItems).toHaveLength(0)
  })
})
