import { hardenGlobals } from './host/singleton-harden';
// Harden pollution-vector keys before any other module-body code runs. §9.4.1.
hardenGlobals();

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/app';
import { initI18n } from './i18n/config';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import { router } from './app/router';
import { setAuthFailureHandler } from './api/client';
import { setAuthFailureRouter, handleAuthFailure } from './api/auth-failure';
import { initAuthBootstrap } from './api/auth-bootstrap';

// Wire auth-failure interceptors before any network calls happen.
setAuthFailureRouter(router);
setAuthFailureHandler((url) => { handleAuthFailure(url); });
initAuthBootstrap();

async function bootstrapStore(): Promise<void> {
  if (import.meta.env.VITEST) return;
  const { useMockStore } = await import('./api/mock-store');
  // Expose the store on window in dev so Playwright E2E tests can read and
  // mutate state without going through the UI.  Guarded by DEV flag — never
  // ships to production builds.
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__RIOKU_STORE = useMockStore;
    // Expose plugin-host snapshots for E2E probing (Task 1f.123). The shape is
    // an accessor object so Playwright reads live state, not a stale snapshot.
    const [
      { usePluginRegistry },
      { listPluginThemes },
      { listSidebarEntries },
      { listPluginRoutes },
      { listSpotlightCommands },
      { getPermissionRegistry },
      { listWidgets },
    ] = await Promise.all([
      import('./host/plugin-registry'),
      import('./host/themes'),
      import('./host/sidebar'),
      import('./host/routes'),
      import('./host/spotlight'),
      import('./host/permissions'),
      import('./host/widgets'),
    ]);
    (window as unknown as Record<string, unknown>).__RIOKU_PLUGIN_HOST = {
      listPlugins: () => usePluginRegistry.getState().listPlugins(),
      listThemes: () => listPluginThemes(),
      listSidebar: (group?: 'general' | 'security' | 'system' | 'plugins') =>
        listSidebarEntries(group),
      listRoutes: () => listPluginRoutes(),
      listSpotlight: () => listSpotlightCommands(),
      listWidgets: () => listWidgets(),
      getPermission: (key: string) => getPermissionRegistry().get(key),
    };
  }
  const { seedStore } = await import('./api/mock-seed');
  const state = useMockStore.getState();
  // Never auto-seed the first-run bootstrap route — the whole point of that
  // page is to run with an empty store so the user can create the first tenant.
  const onBootstrapRoute = window.location.pathname === '/bootstrap';
  if (Object.keys(state.users).length === 0 && !onBootstrapRoute) {
    seedStore(useMockStore);
  }
  // Start dev-only mock audit SSE emitter (30s interval, no-op in prod).
  const { startMockAuditEmitter } = await import('./api/mock-audit-emitter');
  startMockAuditEmitter();
}

const start = async () => {
  // Seed + i18n must both complete before React renders so that TanStack
  // Router's `beforeLoad` guards see a logged-in `currentUserId` and don't
  // bounce to `/login` on first navigation.
  await Promise.all([bootstrapStore(), initI18n()]);
  const container = document.getElementById('root');
  if (!container) throw new Error('Root element not found');
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
};

void start();
