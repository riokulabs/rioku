// Cross-platform keyboard shortcut management.

import { useEffect, useRef, useSyncExternalStore } from 'react'

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

function isMac(): boolean {
  if (typeof navigator === 'undefined') return false
  // navigator.platform is deprecated but widely supported; fall back to userAgentData
  return /mac/i.test(navigator.platform ?? '') || /mac/i.test(navigator.userAgent ?? '')
}

/** Returns the user-facing modifier label for the current platform. */
export function getModLabel(): string {
  return isMac() ? '\u2318' : 'Ctrl'
}

// ---------------------------------------------------------------------------
// Global registry (for help overlay)
// ---------------------------------------------------------------------------

interface RegisteredShortcut {
  key: string
  scope: string
}

type Listener = () => void

const registeredShortcuts: RegisteredShortcut[] = []
const listeners = new Set<Listener>()
let registrySnapshot = 0

function addToRegistry(key: string, scope: string): void {
  if (!registeredShortcuts.some((s) => s.key === key && s.scope === scope)) {
    registeredShortcuts.push({ key, scope })
    registrySnapshot++
    for (const l of listeners) l()
  }
}

function removeFromRegistry(key: string, scope: string): void {
  const idx = registeredShortcuts.findIndex((s) => s.key === key && s.scope === scope)
  if (idx >= 0) {
    registeredShortcuts.splice(idx, 1)
    registrySnapshot++
    for (const l of listeners) l()
  }
}

const subscribe = (listener: Listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const getSnapshot = () => registrySnapshot

/** Returns all registered shortcuts (for help overlay). */
export function useHotkeyRegistry(): RegisteredShortcut[] {
  useSyncExternalStore(subscribe, getSnapshot)
  return [...registeredShortcuts]
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface HotkeyOptions {
  scope?: string
}

/**
 * Register a keyboard shortcut.
 *
 * Key format: modifier tokens separated by `+`, e.g. `"Mod+k"`, `"Shift+Enter"`.
 * `Mod` maps to Meta on macOS, Control on Windows/Linux.
 */
export function useHotkey(
  key: string,
  callback: () => void,
  options?: HotkeyOptions,
): void {
  const cbRef = useRef(callback)
  cbRef.current = callback

  const scope = options?.scope ?? 'global'

  useEffect(() => {
    const parts = key.toLowerCase().split('+')
    const mainKey = parts.pop()!
    const modifiers = new Set(parts)

    const needsCtrl = modifiers.has('ctrl') || (modifiers.has('mod') && !isMac())
    const needsMeta = modifiers.has('meta') || (modifiers.has('mod') && isMac())
    const needsShift = modifiers.has('shift')
    const needsAlt = modifiers.has('alt')

    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey !== needsCtrl) return
      if (e.metaKey !== needsMeta) return
      if (e.shiftKey !== needsShift) return
      if (e.altKey !== needsAlt) return
      if (e.key.toLowerCase() !== mainKey) return

      // Ignore if focus is in an input element (unless explicitly scoped)
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      e.preventDefault()
      cbRef.current()
    }

    addToRegistry(key, scope)
    window.addEventListener('keydown', handler)
    return () => {
      window.removeEventListener('keydown', handler)
      removeFromRegistry(key, scope)
    }
  }, [key, scope])
}
