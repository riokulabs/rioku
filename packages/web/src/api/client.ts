/**
 * Real fetch client — used when VITE_USE_MOCKS=false.
 *
 * When USE_MOCKS is true every method throws MockFetchInterceptError so that
 * feature code that accidentally reaches this client surfaces an error
 * immediately rather than silently doing nothing.
 *
 * Stage 2+ wires real auth by replacing `getSessionToken()` with an actual
 * token source (cookie, Zustand auth slice, etc.).
 *
 * Auth-failure (401) is forwarded to the global interceptor via
 * `handleAuthFailure`, which must be injected via `setAuthFailureHandler`
 * before the first request (called from main.tsx).
 */

import {
  ApiError,
  AuthFailureError,
  MockFetchInterceptError,
  NetworkError,
  PermissionError,
  ServerError,
  ValidationError,
} from './errors';
import { USE_MOCKS } from './mode';

// ─── Auth-failure injection ───────────────────────────────────────────────────

/** Injected from main.tsx to avoid api/ → app/ boundary crossing. */
let _authFailureHandler: ((currentUrl: string) => void) | null = null;

export function setAuthFailureHandler(fn: (currentUrl: string) => void): void {
  _authFailureHandler = fn;
}

// ─── Session token stub ───────────────────────────────────────────────────────

/** Stage 1: always returns null (no auth). Stage 2+: pull from token store. */
function getSessionToken(): string | null {
  return null;
}

// ─── Response parsing ─────────────────────────────────────────────────────────

function getCorrelationId(res: Response): string | undefined {
  return res.headers.get('x-correlation-id') ?? undefined;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null
    ? (v as Record<string, unknown>)
    : null;
}

async function parseError(res: Response): Promise<ApiError> {
  const cid = getCorrelationId(res);
  let body: unknown;
  try {
    body = await res.json() as unknown;
  } catch {
    body = null;
  }

  const rec = asRecord(body);
  const message =
    rec !== null && typeof rec.message === 'string'
      ? rec.message
      : res.statusText;

  if (res.status === 401) {
    return cid !== undefined
      ? new AuthFailureError({ correlationId: cid })
      : new AuthFailureError();
  }
  if (res.status === 403) {
    return cid !== undefined
      ? new PermissionError({ correlationId: cid })
      : new PermissionError();
  }
  if (res.status === 422 || res.status === 400) {
    const rawFields = rec?.fields;
    const fields =
      rawFields !== null &&
      typeof rawFields === 'object' &&
      !Array.isArray(rawFields)
        ? (rawFields as Record<string, string[]>)
        : undefined;
    return fields !== undefined && cid !== undefined
      ? new ValidationError(message, { fields, correlationId: cid })
      : fields !== undefined
        ? new ValidationError(message, { fields })
        : cid !== undefined
          ? new ValidationError(message, { correlationId: cid })
          : new ValidationError(message);
  }
  if (res.status >= 500) {
    return cid !== undefined
      ? new ServerError({ status: res.status, correlationId: cid })
      : new ServerError({ status: res.status });
  }
  return cid !== undefined
    ? new ApiError(message, { status: res.status, correlationId: cid })
    : new ApiError(message, { status: res.status });
}

// ─── Core fetch ──────────────────────────────────────────────────────────────

const BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api/v1';

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  if (USE_MOCKS) {
    throw new MockFetchInterceptError(method, path);
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getSessionToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let res: Response;
  try {
    const fetchInit: RequestInit = { method, headers };
    if (body !== undefined) fetchInit.body = JSON.stringify(body);
    if (signal !== undefined) fetchInit.signal = signal;
    res = await fetch(`${BASE}${path}`, fetchInit);
  } catch (cause) {
    throw new NetworkError({ cause });
  }

  if (!res.ok) {
    const err = await parseError(res);
    if (err instanceof AuthFailureError) {
      _authFailureHandler?.(
        window.location.pathname + window.location.search,
      );
    }
    throw err;
  }

  // 204 No Content
  if (res.status === 204) return undefined as T;

  try {
    return (await res.json()) as T;
  } catch (cause) {
    throw new ApiError('Failed to parse response JSON', { cause });
  }
}

// ─── Public client ────────────────────────────────────────────────────────────

export const apiClient = {
  get<T>(path: string, options?: { signal?: AbortSignal }): Promise<T> {
    return request<T>('GET', path, undefined, options?.signal);
  },

  post<T>(
    path: string,
    body?: unknown,
    options?: { signal?: AbortSignal },
  ): Promise<T> {
    return request<T>('POST', path, body, options?.signal);
  },

  put<T>(
    path: string,
    body?: unknown,
    options?: { signal?: AbortSignal },
  ): Promise<T> {
    return request<T>('PUT', path, body, options?.signal);
  },

  patch<T>(
    path: string,
    body?: unknown,
    options?: { signal?: AbortSignal },
  ): Promise<T> {
    return request<T>('PATCH', path, body, options?.signal);
  },

  delete<T>(path: string, options?: { signal?: AbortSignal }): Promise<T> {
    return request<T>('DELETE', path, undefined, options?.signal);
  },
};
