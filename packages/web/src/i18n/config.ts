import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import HttpBackend from 'i18next-http-backend';
import LanguageDetector from 'i18next-browser-languagedetector';

export const NAMESPACES = [
  'common',
  'auth',
  'dashboard',
  'api-mgmt',
  'ai',
  'analytics',
  'security',
  'plugins',
  'settings',
  'audit',
  'notifications',
] as const;
export type Namespace = (typeof NAMESPACES)[number];

export async function initI18n(): Promise<typeof i18n> {
  await i18n
    .use(HttpBackend)
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      fallbackLng: 'en',
      supportedLngs: ['en', 'ar'],
      ns: ['common'],
      defaultNS: 'common',
      backend: { loadPath: '/locales/{{lng}}/{{ns}}.json' },
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
    });
  return i18n;
}

export default i18n;
