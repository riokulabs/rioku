import { useCallback, useSyncExternalStore } from 'react'

export interface RecentItem {
  type: 'route' | 'service' | 'policy' | 'user' | 'apiKey'
  id: string
  name: string
  path: string
  viewedAt: number
}

const STORAGE_KEY = 'rioku-recently-viewed'
const MAX_ITEMS = 10

let listeners: Array<() => void> = []

function emitChange() {
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners = [...listeners, listener]
  return () => {
    listeners = listeners.filter((l) => l !== listener)
  }
}

function getSnapshot(): string {
  return localStorage.getItem(STORAGE_KEY) ?? '[]'
}

function getServerSnapshot(): string {
  return '[]'
}

function readItems(): RecentItem[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as RecentItem[]
  } catch {
    return []
  }
}

function writeItems(items: RecentItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  emitChange()
}

export function useRecentlyViewed() {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const items: RecentItem[] = (() => {
    try {
      return JSON.parse(raw) as RecentItem[]
    } catch {
      return []
    }
  })()

  const addRecent = useCallback((item: Omit<RecentItem, 'viewedAt'>) => {
    const current = readItems()
    const filtered = current.filter((i) => i.id !== item.id)
    const newItems = [{ ...item, viewedAt: Date.now() }, ...filtered].slice(0, MAX_ITEMS)
    writeItems(newItems)
  }, [])

  const clearRecent = useCallback(() => {
    writeItems([])
  }, [])

  return { recentItems: items, addRecent, clearRecent }
}
