import { hardenGlobals } from './host/singleton-harden';
// Harden pollution-vector keys before any other module-body code runs. §9.4.1.
hardenGlobals();

// Register all feature nav entries before the first render.
import './components/app-shell/nav-bootstrap';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/app';
import { initI18n } from './i18n/config';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import './global.css';
import { router } from './app/router';
import { setAuthFailureHandler, setActiveImpersonationIdAccessor } from './api/mutator';
import { setAuthFailureRouter, handleAuthFailure } from './api/auth-failure';
import { getActiveImpersonationId } from './api/active-impersonation';

// Wire auth-failure interceptors before any network calls happen.
setAuthFailureRouter(router);
setAuthFailureHandler((url) => {
  handleAuthFailure(url);
});

// Stamp X-Impersonation-Id on every daemon-bound request when a
// super-admin session is active. The active id holder is a tiny
// module-level cell (`api/active-impersonation`) — feature code
// writes to it via `setActiveImpersonationId` once the daemon has
// confirmed entry.
setActiveImpersonationIdAccessor(() => getActiveImpersonationId());

async function bootstrapHostSnapshots(): Promise<void> {
  if (import.meta.env.VITEST) return;
  if (!import.meta.env.DEV) return;
  // Expose plugin-host snapshots for E2E probing (Task 1f.123). The shape
  // is an accessor object so Playwright reads live state, not a stale
  // snapshot.
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

const start = async () => {
  // i18n must complete before React renders so the router doesn't flash a
  // mid-load language. Host snapshots run in parallel — they only matter
  // for dev-mode Playwright introspection.
  await Promise.all([initI18n(), bootstrapHostSnapshots()]);
  const container = document.getElementById('root');
  if (!container) throw new Error('Root element not found');
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
};

void start();
