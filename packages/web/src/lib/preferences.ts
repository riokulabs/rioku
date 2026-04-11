// Scoped user preferences persisted to localStorage.
//
// Two scopes:
//   "global" — follows the user across devices (theme, locale, colorblind mode).
//     Key: rioku-pref:global:{userId}:{key}
//   "device" — per-device based on screen/UA hash (table density, columns, sidebar).
//     Key: rioku-pref:device:{userId}:{deviceHash}:{key}

export type PreferenceScope = 'global' | 'device'

// Legacy key used by the old flat preferences system.
const LEGACY_STORAGE_KEY = 'rioku-preferences'

// Marker that legacy migration has already run for a given userId.
function migrationKey(userId: string): string {
  return `rioku-pref:migrated:${userId}`
}

/**
 * djb2 hash of `${screen.width}x${screen.height}:${navigator.userAgent}`.
 * Returns a hex string.
 */
export function getDeviceHash(): string {
  const input =
    typeof window !== 'undefined' && window.screen && window.navigator
      ? `${screen.width}x${screen.height}:${navigator.userAgent}`
      : 'unknown'
  return djb2(input)
}

/** djb2 string hash returning an 8-char hex string. */
function djb2(str: string): string {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    // hash * 33 + char
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0
  }
  // Convert to unsigned 32-bit then hex.
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function buildKey(scope: PreferenceScope, userId: string, key: string): string {
  if (scope === 'global') {
    return `rioku-pref:global:${userId}:${key}`
  }
  return `rioku-pref:device:${userId}:${getDeviceHash()}:${key}`
}

/**
 * Read a single preference value from localStorage.
 */
export function getPreference<T>(
  scope: PreferenceScope,
  userId: string,
  key: string,
  defaultValue: T,
): T {
  try {
    const raw = localStorage.getItem(buildKey(scope, userId, key))
    if (raw === null) return defaultValue
    return JSON.parse(raw) as T
  } catch {
    return defaultValue
  }
}

/**
 * Write a single preference value to localStorage.
 */
export function setPreference<T>(
  scope: PreferenceScope,
  userId: string,
  key: string,
  value: T,
): void {
  localStorage.setItem(buildKey(scope, userId, key), JSON.stringify(value))
}

/**
 * Remove a single preference value from localStorage.
 */
export function removePreference(
  scope: PreferenceScope,
  userId: string,
  key: string,
): void {
  localStorage.removeItem(buildKey(scope, userId, key))
}

// ---------------------------------------------------------------------------
// Legacy migration
// ---------------------------------------------------------------------------

interface LegacyNotificationPreferences {
  config: boolean
  health: boolean
  plugins: boolean
}

interface LegacyPreferences {
  theme?: 'dark' | 'light' | 'system'
  sidebarCollapsed?: boolean
  tablePageSize?: number
  notifications?: LegacyNotificationPreferences
  locale?: string
}

// Maps legacy keys to their new scope assignment.
const LEGACY_SCOPE_MAP: Record<string, PreferenceScope> = {
  theme: 'global',
  locale: 'global',
  sidebarCollapsed: 'device',
  tablePageSize: 'device',
  notifications: 'global',
}

/**
 * Migrate old `rioku-preferences` flat blob to new scoped keys.
 * Only runs once per userId (stores a migration marker).
 */
export function migrateLegacyPreferences(userId: string): void {
  if (localStorage.getItem(migrationKey(userId))) return

  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) {
      localStorage.setItem(migrationKey(userId), '1')
      return
    }
    const legacy: LegacyPreferences = JSON.parse(raw)

    for (const [key, scope] of Object.entries(LEGACY_SCOPE_MAP)) {
      const value = legacy[key as keyof LegacyPreferences]
      if (value !== undefined) {
        setPreference(scope, userId, key, value)
      }
    }
  } catch {
    // Corrupt data — ignore and proceed.
  }

  localStorage.setItem(migrationKey(userId), '1')
}

// ---------------------------------------------------------------------------
// Backwards-compatible flat API (deprecated, used by old code paths)
// ---------------------------------------------------------------------------

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

function readLegacy(): Preferences {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
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

function writeLegacy(prefs: Preferences): void {
  localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(prefs))
}

/** @deprecated Use getPreference() with scoped API instead. */
export function getPreferences(): Preferences {
  return readLegacy()
}

/** @deprecated Use setPreference() with scoped API instead. */
export function setPreferenceLegacy<K extends keyof Preferences>(
  key: K,
  value: Preferences[K],
): Preferences {
  const prefs = readLegacy()
  prefs[key] = value
  writeLegacy(prefs)
  return prefs
}

/** @deprecated Use removePreference() with scoped API instead. */
export function resetPreferences(): Preferences {
  const fresh = { ...defaults, notifications: { ...defaults.notifications } }
  writeLegacy(fresh)
  return fresh
}
