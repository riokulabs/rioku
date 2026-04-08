import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useHotkey, useHotkeyRegistry, getModLabel } from '../use-hotkeys'

describe('use-hotkeys', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  describe('getModLabel', () => {
    it('returns Ctrl for non-Mac platforms', () => {
      Object.defineProperty(navigator, 'platform', {
        value: 'Win32',
        writable: true,
      })
      // getModLabel checks navigator.platform
      expect(getModLabel()).toBe('Ctrl')
    })
  })

  describe('useHotkey', () => {
    it('fires callback on matching keydown event', () => {
      const callback = vi.fn()
      renderHook(() => useHotkey('Mod+k', callback))

      // Simulate Ctrl+K (non-Mac)
      act(() => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'k',
            ctrlKey: true,
            metaKey: false,
            shiftKey: false,
            altKey: false,
            bubbles: true,
          }),
        )
      })

      expect(callback).toHaveBeenCalledTimes(1)
    })

    it('does not fire for non-matching key', () => {
      const callback = vi.fn()
      renderHook(() => useHotkey('Mod+k', callback))

      act(() => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'j',
            ctrlKey: true,
            metaKey: false,
            shiftKey: false,
            altKey: false,
            bubbles: true,
          }),
        )
      })

      expect(callback).not.toHaveBeenCalled()
    })

    it('does not fire when modifier does not match', () => {
      const callback = vi.fn()
      renderHook(() => useHotkey('Mod+k', callback))

      act(() => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'k',
            ctrlKey: false,
            metaKey: false,
            shiftKey: false,
            altKey: false,
            bubbles: true,
          }),
        )
      })

      expect(callback).not.toHaveBeenCalled()
    })

    it('ignores events when target is an input element', () => {
      const callback = vi.fn()
      renderHook(() => useHotkey('Mod+k', callback))

      const input = document.createElement('input')
      document.body.appendChild(input)

      act(() => {
        const event = new KeyboardEvent('keydown', {
          key: 'k',
          ctrlKey: true,
          metaKey: false,
          shiftKey: false,
          altKey: false,
          bubbles: true,
        })
        Object.defineProperty(event, 'target', { value: input })
        window.dispatchEvent(event)
      })

      expect(callback).not.toHaveBeenCalled()
      document.body.removeChild(input)
    })

    it('cleans up listener on unmount', () => {
      const callback = vi.fn()
      const { unmount } = renderHook(() => useHotkey('Mod+k', callback))

      unmount()

      act(() => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'k',
            ctrlKey: true,
            metaKey: false,
            shiftKey: false,
            altKey: false,
            bubbles: true,
          }),
        )
      })

      expect(callback).not.toHaveBeenCalled()
    })

    it('handles Shift modifier', () => {
      const callback = vi.fn()
      renderHook(() => useHotkey('Shift+Enter', callback))

      act(() => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            ctrlKey: false,
            metaKey: false,
            shiftKey: true,
            altKey: false,
            bubbles: true,
          }),
        )
      })

      // The hotkey parses case-insensitively, so 'enter' vs 'Enter' matters
      // In the hook, e.key.toLowerCase() is compared to mainKey (from split + pop)
      expect(callback).toHaveBeenCalledTimes(1)
    })
  })

  describe('useHotkeyRegistry', () => {
    it('returns registered shortcuts', () => {
      const callback = vi.fn()
      renderHook(() => useHotkey('Mod+k', callback, { scope: 'global' }))

      const { result } = renderHook(() => useHotkeyRegistry())

      expect(result.current).toContainEqual({
        key: 'Mod+k',
        scope: 'global',
      })
    })

    it('removes shortcut from registry on unmount', () => {
      const callback = vi.fn()
      const { unmount } = renderHook(() =>
        useHotkey('Mod+p', callback, { scope: 'test' }),
      )

      const { result: before } = renderHook(() => useHotkeyRegistry())
      expect(before.current.some((s) => s.key === 'Mod+p')).toBe(true)

      unmount()

      const { result: after } = renderHook(() => useHotkeyRegistry())
      expect(after.current.some((s) => s.key === 'Mod+p')).toBe(false)
    })
  })
})
