import type { PluginDetail } from '@/lib/api'

export const mockPlugins: PluginDetail[] = [
  {
    id: 'plugin-rate-limit',
    name: 'Rate Limiter',
    type: 'middleware',
    status: 'active',
    version: '1.2.0',
    description: 'Token bucket rate limiting with per-IP, per-key, and per-agent scopes',
    config: [
      { key: 'defaultLimit', type: 'number', label: 'Default Limit', value: 1000 },
      { key: 'windowSize', type: 'select', label: 'Window Size', value: 'minute', options: ['second', 'minute', 'hour', 'day'] },
    ],
    dependentRoutes: [
      { routeId: 'route-api-v1', routeName: 'api-v1', policyId: 'pol-rate-limit-global' },
      { routeId: 'route-ai-proxy', routeName: 'ai-proxy', policyId: 'pol-rate-limit-global' },
    ],
    changelog: [
      { version: '1.2.0', date: '2026-04-01', changes: ['Added per-agent scope', 'Token-aware rate limiting'] },
      { version: '1.1.0', date: '2026-03-01', changes: ['Sliding window support'] },
    ],
    rawConfig: { defaultLimit: 1000, windowSize: 'minute' },
  },
  {
    id: 'plugin-jwt-auth',
    name: 'JWT Authenticator',
    type: 'middleware',
    status: 'active',
    version: '1.0.3',
    description: 'Validate JWT Bearer tokens against JWKS endpoints',
    config: [
      { key: 'clockSkew', type: 'string', label: 'Clock Skew Tolerance', value: '30s' },
    ],
    dependentRoutes: [
      { routeId: 'route-api-v1', routeName: 'api-v1', policyId: 'pol-jwt-auth' },
      { routeId: 'route-api-v2', routeName: 'api-v2', policyId: 'pol-jwt-auth' },
    ],
    changelog: [
      { version: '1.0.3', date: '2026-03-15', changes: ['Fixed JWKS rotation caching'] },
    ],
    rawConfig: { clockSkew: '30s' },
  },
  {
    id: 'plugin-cors',
    name: 'CORS Handler',
    type: 'middleware',
    status: 'active',
    version: '1.0.0',
    description: 'Cross-origin resource sharing rules for browser requests',
    config: [],
    dependentRoutes: [
      { routeId: 'route-api-v2', routeName: 'api-v2', policyId: 'pol-cors-permissive' },
      { routeId: 'route-web-app', routeName: 'web-app', policyId: 'pol-cors-permissive' },
    ],
    changelog: [],
    rawConfig: {},
  },
  {
    id: 'plugin-circuit-breaker',
    name: 'Circuit Breaker',
    type: 'middleware',
    status: 'active',
    version: '1.1.0',
    description: 'Protect upstreams from cascading failures with three-state circuit breaking',
    config: [
      { key: 'failureThreshold', type: 'number', label: 'Failure Threshold', value: 5 },
      { key: 'resetTimeout', type: 'string', label: 'Reset Timeout', value: '30s' },
    ],
    dependentRoutes: [
      { routeId: 'route-ai-proxy', routeName: 'ai-proxy', policyId: 'pol-circuit-breaker-upstream' },
    ],
    changelog: [
      { version: '1.1.0', date: '2026-03-10', changes: ['Half-open state max requests config'] },
    ],
    rawConfig: { failureThreshold: 5, resetTimeout: '30s' },
  },
  {
    id: 'plugin-cache',
    name: 'Response Cache',
    type: 'middleware',
    status: 'active',
    version: '1.0.1',
    description: 'Cache upstream responses with configurable TTL and vary headers',
    config: [
      { key: 'maxAge', type: 'string', label: 'Default Max Age', value: '3600s' },
      { key: 'maxBodySize', type: 'number', label: 'Max Body Size (KB)', value: 1024 },
    ],
    dependentRoutes: [
      { routeId: 'route-static-assets', routeName: 'static-assets', policyId: 'pol-cache-static' },
    ],
    changelog: [
      { version: '1.0.1', date: '2026-04-07', changes: ['Stale-while-revalidate support'] },
    ],
    rawConfig: { maxAge: '3600s', maxBodySize: 1024 },
  },
  {
    id: 'plugin-transform',
    name: 'Request/Response Transform',
    type: 'middleware',
    status: 'active',
    version: '1.0.0',
    description: 'Modify request and response headers, paths, and query parameters',
    config: [],
    dependentRoutes: [],
    changelog: [],
    rawConfig: {},
  },
  {
    id: 'plugin-llm-proxy',
    name: 'LLM Proxy',
    type: 'proxy',
    status: 'active',
    version: '0.5.0',
    description: 'Semantic rate limiting, token counting, and cost tracking for LLM APIs',
    config: [
      { key: 'enableTokenCounting', type: 'boolean', label: 'Enable Token Counting', value: true },
      { key: 'enableCostTracking', type: 'boolean', label: 'Enable Cost Tracking', value: true },
    ],
    dependentRoutes: [
      { routeId: 'route-ai-proxy', routeName: 'ai-proxy' },
    ],
    changelog: [
      { version: '0.5.0', date: '2026-04-05', changes: ['Initial release with OpenAI and Anthropic support'] },
    ],
    rawConfig: { enableTokenCounting: true, enableCostTracking: true },
  },
]
