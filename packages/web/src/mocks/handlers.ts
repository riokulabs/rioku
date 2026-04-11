import type { RequestHandler } from 'msw'

// Only import handlers for endpoints the backend does NOT serve yet.
// Real endpoints (config, auth, health, audit, keys, plugins) go through
// to the actual backend via onUnhandledRequest: 'bypass'.
import { settingsHandlers } from './handlers/settings'
import { clusterHandlers } from './handlers/cluster'
import { certificatesHandlers } from './handlers/certificates'
import { trafficHandlers } from './handlers/traffic'

export const handlers: RequestHandler[] = [
  ...settingsHandlers,
  ...clusterHandlers,
  ...certificatesHandlers,
  ...trafficHandlers,
]
