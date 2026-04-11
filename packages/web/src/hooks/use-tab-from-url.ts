import { useState, useCallback } from 'react'

/**
 * Synchronize the active tab with the `?tab=` URL search parameter.
 * Enables deep linking to specific tabs.
 */
export function useTabFromUrl(
  defaultTab: string,
  validTabs: readonly string[],
): {
  activeTab: string
  setActiveTab: (tab: string) => void
} {
  const [activeTab, setActiveTabState] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search)
    const urlTab = params.get('tab')
    if (urlTab && validTabs.includes(urlTab)) return urlTab
    return defaultTab
  })

  const setActiveTab = useCallback(
    (tab: string) => {
      if (!validTabs.includes(tab)) return
      setActiveTabState(tab)
      const params = new URLSearchParams(window.location.search)
      if (tab === defaultTab) {
        params.delete('tab')
      } else {
        params.set('tab', tab)
      }
      const search = params.toString()
      const url = window.location.pathname + (search ? `?${search}` : '')
      window.history.replaceState(null, '', url)
    },
    [defaultTab, validTabs],
  )

  return { activeTab, setActiveTab }
}
