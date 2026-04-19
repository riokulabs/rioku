import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/app';
import { initI18n } from './i18n/config';
import '@mantine/core/styles.css';
import { router } from './app/router';
import { setAuthFailureHandler } from './api/client';
import { setAuthFailureRouter, handleAuthFailure } from './api/auth-failure';
import { initAuthBootstrap } from './api/auth-bootstrap';

// Wire auth-failure interceptors before any network calls happen.
setAuthFailureRouter(router);
setAuthFailureHandler((url) => { handleAuthFailure(url); });
initAuthBootstrap();

// Seed the mock store if empty — skipped in Vitest to keep tests isolated.
if (!import.meta.env.VITEST) {
  void import('./api/mock-store').then(({ useMockStore }) => {
    void import('./api/mock-seed').then(({ seedStore }) => {
      const state = useMockStore.getState();
      if (Object.keys(state.users).length === 0) {
        seedStore(useMockStore);
      }
    });
  });
}

const start = async () => {
  await initI18n();
  const container = document.getElementById('root');
  if (!container) throw new Error('Root element not found');
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
};

void start();
