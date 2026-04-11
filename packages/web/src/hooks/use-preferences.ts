// React hook for scoped user preferences.
//
// Uses the scoped preferences API from @/lib/preferences with userId
// from the current session. Falls back to 'anonymous' when not authenticated.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useCurrentUser } from '@/hooks/use-auth'
import {
  type PreferenceScope,
  getPreference,
  setPreference as writePreference,
  migrateLegacyPreferences,
} from '@/lib/preferences'

/**
 * Read and write a single preference value with React state integration.
 *
 * @param key       Preference key name (e.g. 'theme', 'sidebarCollapsed')
 * @param defaultValue  Fallback when no stored value exists
 * @param scope     'global' (follows user) or 'device' (per screen/UA). Default: 'global'
 */
export function usePreferences<T>(
  key: string,
  defaultValue: T,
  scope: PreferenceScope = 'global',
): [T, (value: T) => void] {
  const user = useCurrentUser()
  const userId = user?.id ?? 'anonymous'

  // Run legacy migration once per userId.
  const migratedRef = useRef<string | null>(null)
  if (migratedRef.current !== userId) {
    migrateLegacyPreferences(userId)
    migratedRef.current = userId
  }

  const [value, setValue] = useState<T>(() =>
    getPreference(scope, userId, key, defaultValue),
  )

  // Re-read when userId, key, or scope changes.
  useEffect(() => {
    setValue(getPreference(scope, userId, key, defaultValue))
  }, [scope, userId, key]) // eslint-disable-line react-hooks/exhaustive-deps

  const update = useCallback(
    (newValue: T) => {
      writePreference(scope, userId, key, newValue)
      setValue(newValue)
    },
    [scope, userId, key],
  )

  return [value, update]
}
