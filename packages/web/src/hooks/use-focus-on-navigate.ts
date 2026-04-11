import { useEffect, useRef } from 'react'
import { useRouterState } from '@tanstack/react-router'

/**
 * Moves focus to the first <h1> element after each client-side navigation.
 * Improves keyboard and screen-reader UX by announcing the new page context.
 */
export function useFocusOnNavigate(): void {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const prevPathname = useRef(pathname)

  useEffect(() => {
    if (prevPathname.current === pathname) return
    prevPathname.current = pathname

    requestAnimationFrame(() => {
      const h1 = document.querySelector('h1')
      if (h1) {
        h1.setAttribute('tabindex', '-1')
        h1.focus({ preventScroll: false })
      }
    })
  }, [pathname])
}
