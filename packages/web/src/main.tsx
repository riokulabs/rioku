import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { routeTree } from './routeTree.gen'
import '@/lib/i18n'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

const router = createRouter({
  routeTree,
  context: { queryClient },
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
  interface RouterContext {
    queryClient: QueryClient
  }
}

async function startApp() {
  const forceMock = import.meta.env.VITE_MOCK === 'true'

  if (forceMock) {
    // Full mock mode — MSW handles everything
    try {
      const { worker } = await import('./mocks/browser')
      await worker.start({ onUnhandledRequest: 'bypass' })
      sessionStorage.setItem('rioku-mock-session', 'true')
    } catch {
      // Service worker may fail in some environments
    }
  } else {
    // Real backend mode — check health, start MSW only if backend is down
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 2000)
      const res = await fetch('/api/v1/health', { signal: controller.signal })
      clearTimeout(timeout)
      if (!res.ok) throw new Error('unhealthy')
      // Backend is healthy — no MSW needed
    } catch {
      // Backend unreachable — start MSW for full mock mode
      try {
        const { worker } = await import('./mocks/browser')
        await worker.start({ onUnhandledRequest: 'bypass' })
        sessionStorage.setItem('rioku-mock-session', 'true')
      } catch {
        // Service worker may fail
      }
    }
  }

  const root = document.getElementById('root')!
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </React.StrictMode>,
  )
}

startApp()
