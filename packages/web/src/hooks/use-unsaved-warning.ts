import { useEffect, useCallback } from 'react'

/**
 * Attach a `beforeunload` warning when the form has unsaved changes.
 * Also provides a `confirmDiscard()` function for in-app navigation guards.
 */
export function useUnsavedWarning(isDirty: boolean): {
  confirmDiscard: () => boolean
} {
  const handleBeforeUnload = useCallback(
    (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault()
      }
    },
    [isDirty],
  )

  useEffect(() => {
    if (isDirty) {
      window.addEventListener('beforeunload', handleBeforeUnload)
      return () => window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [isDirty, handleBeforeUnload])

  const confirmDiscard = useCallback(() => {
    if (!isDirty) return true
    return window.confirm('You have unsaved changes. Discard them?')
  }, [isDirty])

  return { confirmDiscard }
}
