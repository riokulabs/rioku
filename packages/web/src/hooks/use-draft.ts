import { useState, useEffect, useCallback, useRef } from 'react'

const SAVE_INTERVAL_MS = 30_000

interface DraftData<T> {
  values: T
  timestamp: number
}

export interface UseDraftReturn {
  hasDraft: boolean
  draftTimestamp: number | null
  restoreDraft: () => void
  discardDraft: () => void
  clearDraft: () => void
}

function storageKey(entityType: string): string {
  return `rioku-draft:${entityType}`
}

function readDraft<T>(entityType: string): DraftData<T> | null {
  try {
    const raw = localStorage.getItem(storageKey(entityType))
    if (!raw) return null
    return JSON.parse(raw) as DraftData<T>
  } catch {
    return null
  }
}

export function useDraft<T>(
  entityType: string,
  formValues: T,
  setFormValues: (v: T) => void,
  initialValues?: T,
): UseDraftReturn {
  const [hasDraft, setHasDraft] = useState(false)
  const [draftTimestamp, setDraftTimestamp] = useState<number | null>(null)
  const formValuesRef = useRef(formValues)
  formValuesRef.current = formValues

  // Check for existing draft on mount
  useEffect(() => {
    const draft = readDraft<T>(entityType)
    if (draft) {
      setHasDraft(true)
      setDraftTimestamp(draft.timestamp)
    }
  }, [entityType])

  // Auto-save interval
  useEffect(() => {
    const interval = setInterval(() => {
      const currentValues = formValuesRef.current
      // Only save if values differ from initial (non-empty form)
      if (initialValues && JSON.stringify(currentValues) === JSON.stringify(initialValues)) {
        return
      }
      const data: DraftData<T> = {
        values: currentValues,
        timestamp: Date.now(),
      }
      localStorage.setItem(storageKey(entityType), JSON.stringify(data))
    }, SAVE_INTERVAL_MS)

    return () => clearInterval(interval)
  }, [entityType, initialValues])

  const restoreDraft = useCallback(() => {
    const draft = readDraft<T>(entityType)
    if (draft) {
      setFormValues(draft.values)
      setHasDraft(false)
      setDraftTimestamp(null)
    }
  }, [entityType, setFormValues])

  const discardDraft = useCallback(() => {
    localStorage.removeItem(storageKey(entityType))
    setHasDraft(false)
    setDraftTimestamp(null)
  }, [entityType])

  const clearDraft = useCallback(() => {
    localStorage.removeItem(storageKey(entityType))
    setHasDraft(false)
    setDraftTimestamp(null)
  }, [entityType])

  return { hasDraft, draftTimestamp, restoreDraft, discardDraft, clearDraft }
}
