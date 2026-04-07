// Typed user preferences persisted to localStorage.

const STORAGE_KEY = 'rioku-preferences'

export interface NotificationPreferences {
  config: boolean
  health: boolean
  plugins: boolean
}

export interface Preferences {
  theme: 'dark' | 'light' | 'system'
  sidebarCollapsed: boolean
  tablePageSize: number
  notifications: NotificationPreferences
  locale: string
}

const defaults: Preferences = {
  theme: 'dark',
  sidebarCollapsed: false,
  tablePageSize: 20,
  notifications: {
    config: true,
    health: true,
    plugins: true,
  },
  locale: 'en',
}

function read(): Preferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...defaults, notifications: { ...defaults.notifications } }
    const parsed = JSON.parse(raw)
    return {
      ...defaults,
      ...parsed,
      notifications: { ...defaults.notifications, ...parsed?.notifications },
    }
  } catch {
    return { ...defaults, notifications: { ...defaults.notifications } }
  }
}

function write(prefs: Preferences): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
}

export function getPreferences(): Preferences {
  return read()
}

export function setPreference<K extends keyof Preferences>(
  key: K,
  value: Preferences[K],
): Preferences {
  const prefs = read()
  prefs[key] = value
  write(prefs)
  return prefs
}

export function resetPreferences(): Preferences {
  const fresh = { ...defaults, notifications: { ...defaults.notifications } }
  write(fresh)
  return fresh
}
