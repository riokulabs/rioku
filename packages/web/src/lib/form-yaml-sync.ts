import { stringify as stringifyYaml, parse as parseYaml } from 'yaml'
import type { RouteFormValues } from '@/lib/schemas/route'
import type { ServiceFormValues } from '@/lib/schemas/service'

// ---------------------------------------------------------------------------
// Labels: Record<string, string> <-> KvPair[]
// ---------------------------------------------------------------------------

export interface KvPair { key: string; value: string }

/** Convert a labels record to an array of KvPairs. */
export function labelsToKvPairs(labels: Record<string, string>): KvPair[] {
  return Object.entries(labels).map(([key, value]) => ({ key, value }))
}

/** Convert KvPairs back to a labels record. Ignores pairs with empty keys. */
export function kvPairsToLabels(pairs: KvPair[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const pair of pairs) {
    if (pair.key.trim()) {
      result[pair.key.trim()] = pair.value
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Route: form -> YAML
// ---------------------------------------------------------------------------

/** Convert route form values to a YAML string suitable for YamlJsonEditor. */
export function routeFormToYaml(values: RouteFormValues): string {
  const doc: Record<string, unknown> = {
    name: values.name,
    enabled: values.enabled,
  }

  // Build matchers object, omitting empty arrays
  const matcher: Record<string, unknown> = {}
  if (values.hosts.length > 0) matcher.hosts = values.hosts
  if (values.paths.length > 0) matcher.paths = values.paths
  if (values.methods.length > 0) matcher.methods = values.methods
  if (values.headers.length > 0) matcher.headers = values.headers

  if (Object.keys(matcher).length > 0) {
    doc.matchers = [matcher]
  }

  // Target
  if (values.targetType === 'service') {
    doc.serviceId = values.serviceId
  } else {
    doc.upstream = {
      address: values.directAddress,
      tls: values.directTls,
    }
  }

  // Optional arrays
  if (values.policyIds.length > 0) {
    doc.policyIds = values.policyIds
  }

  // Labels -- only include if non-empty
  if (Object.keys(values.labels).length > 0) {
    doc.labels = values.labels
  }

  return stringifyYaml(doc, { indent: 2 })
}

// ---------------------------------------------------------------------------
// Route: YAML -> form
// ---------------------------------------------------------------------------

/** Parse a YAML string back to partial route form values. */
export function yamlToRouteForm(yaml: string): Partial<RouteFormValues> & { name: string } {
  const parsed = parseYaml(yaml) as Record<string, unknown> | null
  if (!parsed || typeof parsed !== 'object') {
    return { name: '' }
  }

  const matcher = Array.isArray(parsed.matchers) ? (parsed.matchers[0] as Record<string, unknown> | undefined) : undefined

  const hasUpstream = parsed.upstream && typeof parsed.upstream === 'object'
  const upstream = hasUpstream ? (parsed.upstream as Record<string, unknown>) : null

  return {
    name: (parsed.name as string) || '',
    enabled: parsed.enabled !== undefined ? Boolean(parsed.enabled) : true,
    hosts: (matcher?.hosts as string[]) ?? [],
    paths: (matcher?.paths as RouteFormValues['paths']) ?? [],
    methods: (matcher?.methods as RouteFormValues['methods']) ?? [],
    headers: (matcher?.headers as RouteFormValues['headers']) ?? [],
    targetType: upstream ? 'direct' : 'service',
    serviceId: upstream ? '' : ((parsed.serviceId as string) ?? ''),
    directAddress: upstream ? ((upstream.address as string) ?? '') : '',
    directTls: upstream ? ((upstream.tls as RouteFormValues['directTls']) ?? 'TLS_MODE_OFF') : 'TLS_MODE_OFF',
    policyIds: (parsed.policyIds as string[]) ?? [],
    labels: (parsed.labels as Record<string, string>) ?? {},
    forceTls: Boolean(parsed.forceTls),
    minTlsVersion: ((parsed.minTlsVersion as string) ?? '1.2') as RouteFormValues['minTlsVersion'],
    clientAuth: ((parsed.clientAuth as string) ?? 'off') as RouteFormValues['clientAuth'],
  }
}

// ---------------------------------------------------------------------------
// Service: form -> YAML
// ---------------------------------------------------------------------------

/** Convert service form values to a YAML string. */
export function serviceFormToYaml(values: ServiceFormValues): string {
  const doc: Record<string, unknown> = {
    name: values.name,
    lbPolicy: values.lbPolicy,
    upstreams: values.upstreams.map((u) => ({
      address: u.address,
      weight: u.weight,
      tls: u.tls,
    })),
  }

  // Health check -- only include if enabled
  if (values.activeHealthCheck.enabled) {
    doc.healthCheck = {
      enabled: true,
      path: values.activeHealthCheck.path,
      intervalSeconds: values.activeHealthCheck.intervalSeconds,
      timeoutSeconds: values.activeHealthCheck.timeoutSeconds,
      healthyThreshold: values.activeHealthCheck.healthyThreshold,
      unhealthyThreshold: values.activeHealthCheck.unhealthyThreshold,
      expectedStatuses: values.activeHealthCheck.expectedStatuses,
    }
  }

  // Labels -- only include if non-empty
  if (Object.keys(values.labels).length > 0) {
    doc.labels = values.labels
  }

  return stringifyYaml(doc, { indent: 2 })
}

// ---------------------------------------------------------------------------
// Service: YAML -> form
// ---------------------------------------------------------------------------

/** Parse a YAML string back to partial service form values. */
export function yamlToServiceForm(yaml: string): Partial<ServiceFormValues> & { name: string } {
  const parsed = parseYaml(yaml) as Record<string, unknown> | null
  if (!parsed || typeof parsed !== 'object') {
    return { name: '' }
  }

  const hc = parsed.healthCheck as Record<string, unknown> | undefined

  return {
    name: (parsed.name as string) || '',
    lbPolicy: (parsed.lbPolicy as ServiceFormValues['lbPolicy']) ?? 'LB_POLICY_ROUND_ROBIN',
    upstreams: Array.isArray(parsed.upstreams)
      ? (parsed.upstreams as Array<Record<string, unknown>>).map((u) => ({
          address: (u.address as string) || '',
          weight: (u.weight as number) ?? 1,
          tls: (u.tls as ServiceFormValues['upstreams'][number]['tls']) ?? 'TLS_MODE_OFF',
        }))
      : [{ address: '', weight: 1, tls: 'TLS_MODE_OFF' as const }],
    activeHealthCheck: hc
      ? {
          enabled: Boolean(hc.enabled),
          path: (hc.path as string) || '/health',
          intervalSeconds: (hc.intervalSeconds as number) || 10,
          timeoutSeconds: (hc.timeoutSeconds as number) || 5,
          healthyThreshold: (hc.healthyThreshold as number) || 2,
          unhealthyThreshold: (hc.unhealthyThreshold as number) || 3,
          expectedStatuses: (hc.expectedStatuses as number[]) || [200],
        }
      : undefined,
    labels: (parsed.labels as Record<string, string>) ?? {},
  }
}

// ---------------------------------------------------------------------------
// Policy: config -> YAML
// ---------------------------------------------------------------------------

/** Convert policy type + name + config to a YAML string. */
export function policyConfigToYaml(
  type: string,
  name: string,
  config: Record<string, unknown>,
): string {
  const doc = {
    type,
    name,
    config,
  }
  return stringifyYaml(doc, { indent: 2 })
}

// ---------------------------------------------------------------------------
// Policy: YAML -> config
// ---------------------------------------------------------------------------

/** Parse a YAML string back to policy type, name, and config. */
export function yamlToPolicyConfig(yaml: string): {
  type?: string
  name?: string
  config: Record<string, unknown>
} {
  const parsed = parseYaml(yaml) as Record<string, unknown> | null
  if (!parsed || typeof parsed !== 'object') {
    return { config: {} }
  }

  return {
    type: parsed.type as string | undefined,
    name: parsed.name as string | undefined,
    config: (parsed.config as Record<string, unknown>) ?? {},
  }
}
