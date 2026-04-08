import { describe, it, expect } from 'vitest'
import { cn } from '../utils'

describe('cn', () => {
  it('merges multiple class strings', () => {
    expect(cn('foo', 'bar')).toBe('foo bar')
  })

  it('handles conditional classes', () => {
    expect(cn('base', false && 'hidden', 'extra')).toBe('base extra')
  })

  it('resolves conflicting Tailwind classes (later wins)', () => {
    // twMerge should keep only the last conflicting utility
    expect(cn('px-2', 'px-4')).toBe('px-4')
  })

  it('handles empty inputs', () => {
    expect(cn()).toBe('')
    expect(cn('')).toBe('')
    expect(cn(undefined, null, false)).toBe('')
  })

  it('handles array inputs', () => {
    expect(cn(['foo', 'bar'])).toBe('foo bar')
  })

  it('merges objects', () => {
    expect(cn({ hidden: true, flex: false })).toBe('hidden')
  })
})
