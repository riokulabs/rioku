import { RateLimitForm } from './rate-limit-form'
import { AuthJwtForm } from './auth-jwt-form'
import { AuthApiKeyForm } from './auth-api-key-form'
import { CorsForm } from './cors-form'
import { TransformForm } from './transform-form'
import { CircuitBreakerForm } from './circuit-breaker-form'
import { CacheForm } from './cache-form'
import { RetryForm } from './retry-form'
import type { PolicyFormProps } from './types'

const FORM_MAP: Record<string, React.ComponentType<PolicyFormProps>> = {
  POLICY_TYPE_RATE_LIMIT: RateLimitForm,
  POLICY_TYPE_AUTHENTICATION: AuthJwtForm,
  POLICY_TYPE_AUTH_API_KEY: AuthApiKeyForm,
  POLICY_TYPE_CORS: CorsForm,
  POLICY_TYPE_TRANSFORM: TransformForm,
  POLICY_TYPE_CIRCUIT_BREAKER: CircuitBreakerForm,
  POLICY_TYPE_CACHE: CacheForm,
  POLICY_TYPE_RETRY: RetryForm,
}

export function PolicyFormForType({ type, ...props }: PolicyFormProps & { type: string }) {
  const FormComponent = FORM_MAP[type]
  if (!FormComponent) return <p className="text-sm text-muted-foreground">Unknown policy type.</p>
  return <FormComponent {...props} />
}

export { FORM_MAP }
export type { PolicyFormProps }
