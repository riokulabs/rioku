import { z } from 'zod'

export const LB_POLICIES = [
  'LB_POLICY_UNSPECIFIED',
  'LB_POLICY_ROUND_ROBIN',
  'LB_POLICY_RANDOM',
  'LB_POLICY_LEAST_CONN',
  'LB_POLICY_IP_HASH',
  'LB_POLICY_WEIGHTED_ROUND_ROBIN',
] as const

export const LB_POLICY_LABELS: Record<string, string> = {
  LB_POLICY_UNSPECIFIED: 'None',
  LB_POLICY_ROUND_ROBIN: 'Round Robin',
  LB_POLICY_RANDOM: 'Random',
  LB_POLICY_LEAST_CONN: 'Least Connections',
  LB_POLICY_IP_HASH: 'IP Hash',
  LB_POLICY_WEIGHTED_ROUND_ROBIN: 'Weighted Round Robin',
}

export const TLS_MODES = ['TLS_MODE_OFF', 'TLS_MODE_AUTO', 'TLS_MODE_CUSTOM', 'TLS_MODE_INTERNAL'] as const

export const TLS_MODE_LABELS: Record<string, string> = {
  TLS_MODE_OFF: 'Off',
  TLS_MODE_AUTO: 'Auto',
  TLS_MODE_CUSTOM: 'Custom',
  TLS_MODE_INTERNAL: 'Internal (mTLS)',
}

export const upstreamSchema = z.object({
  address: z.string().min(1, 'Address is required'),
  weight: z.number().min(0, 'Weight must be non-negative'),
  tls: z.enum(TLS_MODES),
})

export const activeHealthCheckSchema = z.object({
  enabled: z.boolean(),
  path: z.string(),
  intervalSeconds: z.number().min(0),
  timeoutSeconds: z.number().min(0),
  healthyThreshold: z.number().min(0),
  unhealthyThreshold: z.number().min(0),
  expectedStatuses: z.array(z.number()),
}).refine(
  (data) => !data.enabled || data.path.length > 0,
  { message: 'Health check path is required when enabled', path: ['path'] },
)

export const passiveHealthCheckSchema = z.object({
  enabled: z.boolean(),
  failureWindow: z.string(),
  maxFailures: z.number().min(0),
  latencyThreshold: z.string(),
  unhealthyStatuses: z.array(z.number()),
})

export const timeoutsSchema = z.object({
  dial: z.string(),
  responseHeader: z.string(),
  idle: z.string(),
})

export const retriesSchema = z.object({
  maxAttempts: z.number().min(0),
  retryStatuses: z.array(z.number()),
})

export const connectionPoolSchema = z.object({
  maxConnsPerHost: z.number().min(0),
  maxIdleConns: z.number().min(0),
  keepAliveInterval: z.string(),
})

export const TLS_UPSTREAM_MODES = ['auto', 'off', 'on', 'mtls'] as const

export const TLS_UPSTREAM_LABELS: Record<string, string> = {
  auto: 'Auto',
  off: 'Off',
  on: 'On',
  mtls: 'mTLS',
}

export const HTTP_VERSIONS = ['auto', '1.1', '2'] as const

export const HTTP_VERSION_LABELS: Record<string, string> = {
  auto: 'Auto',
  '1.1': 'HTTP/1.1',
  '2': 'HTTP/2',
}

export const transportSchema = z.object({
  tlsToUpstream: z.enum(TLS_UPSTREAM_MODES),
  httpVersion: z.enum(HTTP_VERSIONS),
  keepAlive: z.boolean(),
})

export const serviceFormSchema = z.object({
  name: z.string().min(1, 'Service name is required').max(128, 'Service name too long'),
  lbPolicy: z.enum(LB_POLICIES),
  upstreams: z.array(upstreamSchema).min(1, 'At least one upstream is required'),
  activeHealthCheck: activeHealthCheckSchema,
  passiveHealthCheck: passiveHealthCheckSchema,
  connectionPool: connectionPoolSchema,
  timeouts: timeoutsSchema,
  retries: retriesSchema,
  transport: transportSchema,
  labels: z.record(z.string(), z.string()),
})

export type ServiceFormValues = z.infer<typeof serviceFormSchema>
export type UpstreamValues = z.infer<typeof upstreamSchema>

/** Convert an API Service to form values. */
export function serviceToFormValues(service: {
  name: string
  lbPolicy: string
  upstreams: Array<{ address: string; weight: number; tls: string }>
  healthCheck?: { enabled: boolean; path: string; intervalSeconds: number; timeoutSeconds: number; unhealthyThreshold?: number; healthyThreshold?: number; expectedStatuses?: number[] } | null
  labels?: Record<string, string> | null
}): ServiceFormValues {
  const hc = service.healthCheck
  return {
    name: service.name,
    lbPolicy: service.lbPolicy as ServiceFormValues['lbPolicy'],
    upstreams: service.upstreams.map((u) => ({
      address: u.address,
      weight: u.weight,
      tls: u.tls as UpstreamValues['tls'],
    })),
    activeHealthCheck: {
      enabled: hc?.enabled ?? false,
      path: hc?.path ?? '/health',
      intervalSeconds: hc?.intervalSeconds ?? 10,
      timeoutSeconds: hc?.timeoutSeconds ?? 5,
      healthyThreshold: hc?.healthyThreshold ?? 2,
      unhealthyThreshold: hc?.unhealthyThreshold ?? 3,
      expectedStatuses: hc?.expectedStatuses ?? [200],
    },
    passiveHealthCheck: {
      enabled: false,
      failureWindow: '',
      maxFailures: 5,
      latencyThreshold: '',
      unhealthyStatuses: [],
    },
    timeouts: { dial: '', responseHeader: '', idle: '' },
    retries: { maxAttempts: 0, retryStatuses: [] },
    connectionPool: { maxConnsPerHost: 0, maxIdleConns: 0, keepAliveInterval: '' },
    transport: { tlsToUpstream: 'off', httpVersion: 'auto', keepAlive: true },
    labels: service.labels ?? {},
  }
}

/** Convert form values to API payload. */
export function formValuesToServicePayload(
  values: ServiceFormValues,
  existingId?: string,
): Record<string, unknown> {
  return {
    ...(existingId ? { id: existingId } : {}),
    name: values.name,
    lbPolicy: values.lbPolicy,
    upstreams: values.upstreams.map((u) => ({
      id: '',
      address: u.address,
      weight: u.weight,
      tls: u.tls,
      healthy: true,
    })),
    healthCheck: values.activeHealthCheck.enabled
      ? {
          enabled: true,
          path: values.activeHealthCheck.path,
          intervalSeconds: values.activeHealthCheck.intervalSeconds,
          timeoutSeconds: values.activeHealthCheck.timeoutSeconds,
          healthyThreshold: values.activeHealthCheck.healthyThreshold,
          unhealthyThreshold: values.activeHealthCheck.unhealthyThreshold,
          expectedStatuses: values.activeHealthCheck.expectedStatuses,
        }
      : null,
    labels: Object.keys(values.labels).length > 0 ? values.labels : null,
  }
}
