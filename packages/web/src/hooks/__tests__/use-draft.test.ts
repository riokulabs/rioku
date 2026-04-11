import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDraft } from '../use-draft'

describe('useDraft', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns hasDraft=false when no draft exists', () => {
    const setter = vi.fn()
    const { result } = renderHook(() =>
      useDraft('route', { name: '' }, setter, { name: '' }),
    )
    expect(result.current.hasDraft).toBe(false)
    expect(result.current.draftTimestamp).toBeNull()
  })

  it('hasDraft=true when draft exists on mount', () => {
    localStorage.setItem(
      'rioku-draft:route',
      JSON.stringify({ values: { name: 'test' }, timestamp: 1000 }),
    )
    const setter = vi.fn()
    const { result } = renderHook(() =>
      useDraft('route', { name: '' }, setter, { name: '' }),
    )
    expect(result.current.hasDraft).toBe(true)
    expect(result.current.draftTimestamp).toBe(1000)
  })

  it('restoreDraft loads saved values', () => {
    localStorage.setItem(
      'rioku-draft:route',
      JSON.stringify({ values: { name: 'restored' }, timestamp: 2000 }),
    )
    const setter = vi.fn()
    const { result } = renderHook(() =>
      useDraft('route', { name: '' }, setter, { name: '' }),
    )

    act(() => {
      result.current.restoreDraft()
    })

    expect(setter).toHaveBeenCalledWith({ name: 'restored' })
    expect(result.current.hasDraft).toBe(false)
  })

  it('discardDraft removes from localStorage', () => {
    localStorage.setItem(
      'rioku-draft:route',
      JSON.stringify({ values: { name: 'discard' }, timestamp: 3000 }),
    )
    const setter = vi.fn()
    const { result } = renderHook(() =>
      useDraft('route', { name: '' }, setter, { name: '' }),
    )

    act(() => {
      result.current.discardDraft()
    })

    expect(localStorage.getItem('rioku-draft:route')).toBeNull()
    expect(result.current.hasDraft).toBe(false)
  })

  it('clearDraft removes from localStorage', () => {
    localStorage.setItem(
      'rioku-draft:route',
      JSON.stringify({ values: { name: 'clear' }, timestamp: 4000 }),
    )
    const setter = vi.fn()
    const { result } = renderHook(() =>
      useDraft('route', { name: '' }, setter, { name: '' }),
    )

    act(() => {
      result.current.clearDraft()
    })

    expect(localStorage.getItem('rioku-draft:route')).toBeNull()
    expect(result.current.hasDraft).toBe(false)
  })

  it('auto-saves after interval when values differ from initial', () => {
    const setter = vi.fn()
    renderHook(() =>
      useDraft('route', { name: 'changed' }, setter, { name: '' }),
    )

    act(() => {
      vi.advanceTimersByTime(30_000)
    })

    const saved = localStorage.getItem('rioku-draft:route')
    expect(saved).not.toBeNull()
    const parsed = JSON.parse(saved!)
    expect(parsed.values.name).toBe('changed')
  })

  it('does not auto-save when values equal initial', () => {
    const setter = vi.fn()
    renderHook(() =>
      useDraft('route', { name: '' }, setter, { name: '' }),
    )

    act(() => {
      vi.advanceTimersByTime(30_000)
    })

    expect(localStorage.getItem('rioku-draft:route')).toBeNull()
  })
})
