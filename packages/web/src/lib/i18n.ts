import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import common from '@/locales/en/common.json'
import dashboard from '@/locales/en/dashboard.json'
import routes from '@/locales/en/routes.json'
import services from '@/locales/en/services.json'
import policies from '@/locales/en/policies.json'
import traffic from '@/locales/en/traffic.json'
import security from '@/locales/en/security.json'
import settings from '@/locales/en/settings.json'
import cluster from '@/locales/en/cluster.json'
import plugins from '@/locales/en/plugins.json'
import audit from '@/locales/en/audit.json'

const STORAGE_KEY = 'rioku-preferences'

function detectStoredLocale(): string | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return undefined
    const parsed = JSON.parse(raw)
    return parsed?.locale
  } catch {
    return undefined
  }
}

i18n.use(initReactI18next).init({
  lng: detectStoredLocale() || navigator.language?.split('-')[0] || 'en',
  fallbackLng: 'en',
  defaultNS: 'common',
  ns: [
    'common',
    'dashboard',
    'routes',
    'services',
    'policies',
    'traffic',
    'security',
    'settings',
    'cluster',
    'plugins',
    'audit',
  ],
  interpolation: {
    escapeValue: false,
  },
  resources: {
    en: {
      common,
      dashboard,
      routes,
      services,
      policies,
      traffic,
      security,
      settings,
      cluster,
      plugins,
      audit,
    },
  },
})

export default i18n
