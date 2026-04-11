import { useMemo } from 'react'

interface DirtyFormResult {
  isDirty: boolean
  changedFields: string[]
}

/**
 * Compare initial and current form values to detect unsaved changes.
 * Uses JSON serialization for deep comparison of arrays and objects.
 */
export function useDirtyForm<T extends Record<string, unknown>>(
  initial: T,
  current: T,
): DirtyFormResult {
  return useMemo(() => {
    const changedFields: string[] = []
    const keys = Object.keys(initial) as Array<keyof T & string>

    for (const key of keys) {
      const a = initial[key]
      const b = current[key]
      if (a === b) continue
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        changedFields.push(key)
      }
    }

    return { isDirty: changedFields.length > 0, changedFields }
  }, [initial, current])
}
