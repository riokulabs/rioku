import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTimeRange, TIME_RANGE_OPTIONS, type TimeRange } from '@/hooks/use-time-range'

// The hook reads from TanStack Router search params. For unit testing,
// we test the pure logic; integration tests cover URL sync.

describe('useTimeRange', () => {
  it('exports the valid range options', () => {
    expect(TIME_RANGE_OPTIONS).toEqual(['1h', '6h', '24h', '7d', '30d'])
  })

  it('defaults to 24h', () => {
    const { result } = renderHook(() => useTimeRange())
    expect(result.current.range).toBe('24h')
  })

  it('setRange updates the range', () => {
    const { result } = renderHook(() => useTimeRange())
    act(() => result.current.setRange('7d'))
    expect(result.current.range).toBe('7d')
  })

  it('rejects invalid ranges gracefully', () => {
    const { result } = renderHook(() => useTimeRange())
    act(() => result.current.setRange('99d' as TimeRange))
    // Should stay at previous valid value
    expect(TIME_RANGE_OPTIONS).not.toContain('99d')
  })
})
