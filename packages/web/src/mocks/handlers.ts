import type { RequestHandler } from 'msw'
import { configHandlers } from './handlers/config'
import { authHandlers } from './handlers/auth'
import { healthHandlers } from './handlers/health'
import { auditHandlers } from './handlers/audit'
import { settingsHandlers } from './handlers/settings'
import { clusterHandlers } from './handlers/cluster'
import { pluginsHandlers } from './handlers/plugins'
import { certificatesHandlers } from './handlers/certificates'
import { trafficHandlers } from './handlers/traffic'
import { keysHandlers } from './handlers/keys'

export const handlers: RequestHandler[] = [
  ...configHandlers,
  ...authHandlers,
  ...healthHandlers,
  ...auditHandlers,
  ...settingsHandlers,
  ...clusterHandlers,
  ...pluginsHandlers,
  ...certificatesHandlers,
  ...trafficHandlers,
  ...keysHandlers,
]
