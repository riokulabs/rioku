/**
 * API error taxonomy.
 *
 * All errors extend `ApiError` so callers can do a single `instanceof ApiError`
 * catch or narrow to specific subtypes.
 *
 * `Object.setPrototypeOf(this, new.target.prototype)` in each constructor
 * ensures `instanceof` works correctly after TypeScript/Babel transpilation.
 */

/** Base class for all Rioku API errors. */
export class ApiError extends Error {
  /** HTTP status code, if applicable. */
  readonly status: number | undefined;
  /** Server-supplied correlation ID for log tracing. */
  readonly correlationId: string | undefined;

  constructor(
    message: string,
    options?: { status?: number; correlationId?: string; cause?: unknown },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = 'ApiError';
    this.status = options?.status;
    this.correlationId = options?.correlationId;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 401 — not authenticated. Handled globally by auth-failure interceptor. */
export class AuthFailureError extends ApiError {
  constructor(options?: { correlationId?: string; cause?: unknown }) {
    super('Authentication required', { status: 401, ...options });
    this.name = 'AuthFailureError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 403 — authenticated but not authorized. */
export class PermissionError extends ApiError {
  constructor(options?: { correlationId?: string; cause?: unknown }) {
    super('Permission denied', { status: 403, ...options });
    this.name = 'PermissionError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 4xx validation failure — carries field-level error details. */
export class ValidationError extends ApiError {
  /** Field-level errors keyed by field name. */
  readonly fields: Record<string, string[]> | undefined;

  constructor(
    message: string,
    options?: {
      fields?: Record<string, string[]>;
      correlationId?: string;
      cause?: unknown;
    },
  ) {
    super(message, { status: 422, ...options });
    this.name = 'ValidationError';
    this.fields = options?.fields;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 5xx server error. */
export class ServerError extends ApiError {
  constructor(options?: { status?: number; correlationId?: string; cause?: unknown }) {
    super('Server error', { status: options?.status ?? 500, ...options });
    this.name = 'ServerError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Network-level failure (fetch threw, no HTTP response). */
export class NetworkError extends ApiError {
  constructor(options?: { correlationId?: string; cause?: unknown }) {
    super('Network error — check your connection', options);
    this.name = 'NetworkError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Sentinel thrown when `apiClient` is called in mock mode.
 * Surfaces immediately if a feature accidentally uses the real client path.
 */
export class MockFetchInterceptError extends Error {
  constructor(method: string, path: string) {
    super(
      `[mock] apiClient.${method}("${path}") was called while VITE_USE_MOCKS=true. ` +
        'Use the mock-store directly instead of going through the real fetch client.',
    );
    this.name = 'MockFetchInterceptError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
