import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useDirtyForm } from '../use-dirty-form'

describe('useDirtyForm', () => {
  it('returns not dirty when values equal initial', () => {
    const initial = { name: 'foo', enabled: true }
    const { result } = renderHook(() => useDirtyForm(initial, initial))
    expect(result.current.isDirty).toBe(false)
    expect(result.current.changedFields).toEqual([])
  })

  it('returns dirty when a string field changes', () => {
    const initial = { name: 'foo', enabled: true }
    const current = { name: 'bar', enabled: true }
    const { result } = renderHook(() => useDirtyForm(initial, current))
    expect(result.current.isDirty).toBe(true)
    expect(result.current.changedFields).toEqual(['name'])
  })

  it('returns dirty when a boolean field changes', () => {
    const initial = { name: 'foo', enabled: true }
    const current = { name: 'foo', enabled: false }
    const { result } = renderHook(() => useDirtyForm(initial, current))
    expect(result.current.isDirty).toBe(true)
    expect(result.current.changedFields).toEqual(['enabled'])
  })

  it('detects array changes', () => {
    const initial = { tags: ['a', 'b'] }
    const current = { tags: ['a', 'c'] }
    const { result } = renderHook(() => useDirtyForm(initial, current))
    expect(result.current.isDirty).toBe(true)
    expect(result.current.changedFields).toEqual(['tags'])
  })

  it('treats identical arrays as not dirty', () => {
    const initial = { tags: ['a', 'b'] }
    const current = { tags: ['a', 'b'] }
    const { result } = renderHook(() => useDirtyForm(initial, current))
    expect(result.current.isDirty).toBe(false)
  })

  it('detects nested object changes via JSON comparison', () => {
    const initial = { meta: { key: 'val' } }
    const current = { meta: { key: 'changed' } }
    const { result } = renderHook(() => useDirtyForm(initial, current))
    expect(result.current.isDirty).toBe(true)
  })
})
