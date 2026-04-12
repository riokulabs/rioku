import { z } from 'zod'

export const PATH_MATCHER_TYPES = ['TYPE_EXACT', 'TYPE_PREFIX', 'TYPE_REGEXP'] as const

export const PATH_MATCHER_TYPE_LABELS: Record<string, string> = {
  TYPE_EXACT: 'Exact',
  TYPE_PREFIX: 'Prefix',
  TYPE_REGEXP: 'Regexp',
}
export const TLS_MODES = ['TLS_MODE_OFF', 'TLS_MODE_AUTO', 'TLS_MODE_CUSTOM', 'TLS_MODE_INTERNAL'] as const
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const
export const MIN_TLS_VERSIONS = ['1.2', '1.3'] as const
export const CLIENT_AUTH_MODES = ['off', 'request', 'require', 'require_and_verify'] as const

export const pathMatcherSchema = z.object({
  type: z.enum(PATH_MATCHER_TYPES),
  value: z.string().min(1, 'Path value is required'),
})

export const headerMatcherSchema = z.object({
  name: z.string().min(1, 'Header name is required'),
  value: z.string(),
  invert: z.boolean().default(false),
})

export const routeFormSchema = z.object({
  name: z.string().min(1, 'Route name is required').max(128, 'Route name too long'),
  enabled: z.boolean(),
  hosts: z.array(z.string()),
  paths: z.array(pathMatcherSchema),
  methods: z.array(z.enum(HTTP_METHODS)),
  headers: z.array(headerMatcherSchema),
  targetType: z.enum(['service', 'direct']),
  serviceId: z.string(),
  directAddress: z.string(),
  directTls: z.enum(TLS_MODES),
  policyIds: z.array(z.string()),
  labels: z.record(z.string(), z.string()),
  // TLS fields -- NEEDS BACKEND (rendered but disabled)
  forceTls: z.boolean(),
  minTlsVersion: z.enum(MIN_TLS_VERSIONS),
  clientAuth: z.enum(CLIENT_AUTH_MODES),
}).refine(
  (data) => {
    if (data.targetType === 'service') return data.serviceId.length > 0
    return data.directAddress.length > 0
  },
  {
    message: 'A service or direct upstream address is required',
    path: ['serviceId'],
  },
)

export type RouteFormValues = z.infer<typeof routeFormSchema>

/** Convert an API Route object to form values. */
export function routeToFormValues(route: {
  name: string
  matchers: Array<{
    hosts?: string[]
    paths?: Array<{ type: string; value: string }>
    methods?: string[]
    headers?: Array<{ name: string; value: string; invert?: boolean }>
  }>
  serviceId?: string
  enabled: boolean
  policyIds?: string[]
  labels?: Record<string, string> | null
}): RouteFormValues {
  const m = route.matchers[0]
  return {
    name: route.name,
    enabled: route.enabled,
    hosts: m?.hosts ?? [],
    paths: (m?.paths ?? []).map((p) => ({
      type: p.type as RouteFormValues['paths'][number]['type'],
      value: p.value,
    })),
    methods: (m?.methods ?? []) as RouteFormValues['methods'],
    headers: (m?.headers ?? []).map((h) => ({
      name: h.name,
      value: h.value,
      invert: h.invert ?? false,
    })),
    targetType: route.serviceId ? 'service' : 'direct',
    serviceId: route.serviceId ?? '',
    directAddress: '',
    directTls: 'TLS_MODE_OFF',
    policyIds: route.policyIds ?? [],
    labels: route.labels ?? {},
    forceTls: false,
    minTlsVersion: '1.2',
    clientAuth: 'off',
  }
}

/** Convert form values back to the API payload shape. */
export function formValuesToRoutePayload(
  values: RouteFormValues,
  existingId?: string,
): Record<string, unknown> {
  const route: Record<string, unknown> = {
    ...(existingId ? { id: existingId } : {}),
    name: values.name,
    enabled: values.enabled,
    matchers: [
      {
        ...(values.hosts.length > 0 ? { hosts: values.hosts } : {}),
        ...(values.paths.length > 0 ? { paths: values.paths } : {}),
        ...(values.methods.length > 0 ? { methods: values.methods } : {}),
        ...(values.headers.length > 0 ? { headers: values.headers } : {}),
      },
    ],
    policyIds: values.policyIds,
    labels: Object.keys(values.labels).length > 0 ? values.labels : null,
  }

  if (values.targetType === 'service') {
    route.serviceId = values.serviceId
  } else {
    route.upstream = {
      address: values.directAddress,
      tls: values.directTls,
    }
  }

  return route
}
