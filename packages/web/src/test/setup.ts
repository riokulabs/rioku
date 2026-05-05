import '@testing-library/jest-dom/vitest';
import { expect, afterAll, afterEach, beforeAll } from 'vitest';
import { cleanup } from '@testing-library/react';
import { toHaveNoViolations } from 'jest-axe';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { server } from './msw-server';

expect.extend(toHaveNoViolations as never);

// MSW server lifecycle — bypass unhandled requests so existing tests that stub
// fetch via vi.stubGlobal/vi.fn are not affected.
beforeAll(() => { server.listen({ onUnhandledRequest: 'bypass' }); });
afterEach(() => { server.resetHandlers(); });
afterAll(() => { server.close(); });

// jsdom does not implement ResizeObserver — required by Mantine's ScrollArea.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
window.ResizeObserver ??= class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// jsdom does not implement scrollIntoView — Mantine's Combobox calls it after
// option selection; stub it to suppress "not a function" uncaught exceptions.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, @typescript-eslint/unbound-method
window.HTMLElement.prototype.scrollIntoView ??= function scrollIntoViewStub() {};

// jsdom does not implement window.matchMedia — required by Mantine's color-scheme logic
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// Initialize i18n synchronously with inline resources so tests don't need
// the dev server to load /locales/*.json via HTTP backend.
beforeAll(async () => {
  if (!i18n.isInitialized) {
    await i18n.use(initReactI18next).init({
      lng: 'en',
      fallbackLng: 'en',
      ns: ['common'],
      defaultNS: 'common',
      resources: {
        en: { common: {} },
        ar: { common: {} },
      },
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
    });
  }
});

afterEach(() => {
  cleanup();
});
