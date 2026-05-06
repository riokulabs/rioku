import {
  ApiError,
  AuthFailureError,
  NetworkError,
  PermissionError,
  ServerError,
  ValidationError,
} from './errors';

export interface CustomFetchArgs<TData = unknown> {
  url: string;
  method: string;
  data?: TData;
  signal?: AbortSignal;
  params?: Record<string, string | number | boolean | undefined>;
}

let _authFailureHandler: ((currentUrl: string) => void) | null = null;

export function setAuthFailureHandler(fn: (currentUrl: string) => void): void {
  _authFailureHandler = fn;
}

// ─── Impersonation header forwarding ─────────────────────────────────────────
//
// When a super-admin impersonation session is active, every outgoing
// daemon request must carry the session id so the daemon-side audit
// emit code can stamp `acted_as_admin: true` on tenant-side audit
// entries (and skip the same flag on the super-admin log).
//
// The accessor is a tiny module-level pointer set by the impersonation
// state owner (wired from `main.tsx` once the mock-store module has
// loaded). The mutator does not import the store directly — that
// would create a fetch/-store/auth circular import. The only path
// between them is this setter.

let _activeImpersonationId: (() => string | null) | null = null;

export function setActiveImpersonationIdAccessor(
  fn: (() => string | null) | null,
): void {
  _activeImpersonationId = fn;
}

export function getActiveImpersonationId(): string | null {
  return _activeImpersonationId?.() ?? null;
}

/** Path patterns that must NOT receive the impersonation header.
 *  Impersonation-management endpoints are super-admin-self calls and
 *  the session id either does not exist yet (start) or is in the
 *  path (end / touch / list).
 */
function shouldStampImpersonationHeader(url: string): boolean {
  const path = url.split('?')[0] ?? url;
  return !path.includes('/admin/impersonation');
}

const BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api/v1';

function isProblemContentType(ct: string | null): boolean {
  return ct?.toLowerCase().includes('problem+json') ?? false;
}

function getCorrelationId(res: Response): string | undefined {
  return res.headers.get('x-correlation-id') ?? undefined;
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function parseError(res: Response): Promise<ApiError> {
  const cid = getCorrelationId(res);
  const body = await readBody(res);
  const rec = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  const message =
    rec !== null && typeof rec.title === 'string'
      ? rec.title
      : rec !== null && typeof rec.message === 'string'
        ? rec.message
        : res.statusText;

  if (res.status === 401) {
    return cid !== undefined
      ? new AuthFailureError({ correlationId: cid })
      : new AuthFailureError();
  }
  if (res.status === 403) {
    return cid !== undefined ? new PermissionError({ correlationId: cid }) : new PermissionError();
  }
  if (res.status === 422 || res.status === 400) {
    const rawFields = rec?.fields;
    const fields =
      rawFields !== null && typeof rawFields === 'object' && !Array.isArray(rawFields)
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

/**
 * customFetch supports two invocation shapes:
 *
 *   1. The hand-written `{url, method, data, params, signal}` form used by
 *      existing in-tree consumers and the mutator unit test.
 *   2. The Orval-fetch-client form `customFetch(url, RequestInit)` — emitted
 *      by every generated `<entity>.ts`. The body shape returned for this
 *      form is `{ data, status, headers }` (Orval's standard wrapper).
 */
export function customFetch<T>(args: CustomFetchArgs): Promise<T>;
export function customFetch<T>(url: string, init?: RequestInit): Promise<T>;
export async function customFetch<T>(
  argsOrUrl: CustomFetchArgs | string,
  maybeInit?: RequestInit,
): Promise<T> {
  // Branch on call shape. If a string is passed, we're in the Orval form.
  const orvalShape = typeof argsOrUrl === 'string';
  const url = orvalShape ? argsOrUrl : argsOrUrl.url;
  const method = orvalShape
    ? (maybeInit?.method ?? 'GET')
    : argsOrUrl.method;
  const data = orvalShape ? undefined : argsOrUrl.data;
  const signal = orvalShape ? maybeInit?.signal : argsOrUrl.signal;
  const params = orvalShape ? undefined : argsOrUrl.params;
  const orvalBody = orvalShape ? maybeInit?.body : undefined;
  const orvalHeaders = orvalShape ? maybeInit?.headers : undefined;

  let fullUrl = url.startsWith('http') ? url : `${BASE}${url}`;
  // Strip duplicate API prefix when generated paths already include it.
  if (BASE === '/api/v1' && fullUrl.startsWith('/api/v1/api/v1/')) {
    fullUrl = fullUrl.slice('/api/v1'.length);
  }
  if (params !== undefined && Object.keys(params).length > 0) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) qs.set(k, String(v));
    }
    fullUrl = `${fullUrl}${fullUrl.includes('?') ? '&' : '?'}${qs.toString()}`;
  }

  const headers: Record<string, string> = {};
  if (orvalHeaders) {
    if (orvalHeaders instanceof Headers) {
      orvalHeaders.forEach((value, key) => {
        headers[key] = value;
      });
    } else if (Array.isArray(orvalHeaders)) {
      for (const [k, v] of orvalHeaders) headers[k] = v;
    } else {
      Object.assign(headers, orvalHeaders);
    }
  }
  // Stamp the active impersonation session id on every outgoing
  // daemon request except impersonation-management calls themselves.
  // The daemon will use this header to set `acted_as_admin: true`
  // on tenant-side audit entries.
  const impId = getActiveImpersonationId();
  if (impId !== null && shouldStampImpersonationHeader(fullUrl)) {
    if (!('x-impersonation-id' in headers) && !('X-Impersonation-Id' in headers)) {
      headers['x-impersonation-id'] = impId;
    }
  }

  const fetchInit: RequestInit = {
    method,
    headers,
    credentials: 'include',
  };
  if (data !== undefined) {
    headers['content-type'] = 'application/json';
    fetchInit.body = JSON.stringify(data);
  } else if (orvalBody !== undefined) {
    fetchInit.body = orvalBody;
    if (
      typeof orvalBody === 'string' &&
      !('content-type' in headers) &&
      !('Content-Type' in headers)
    ) {
      headers['content-type'] = 'application/json';
    }
  }
  if (signal !== undefined) fetchInit.signal = signal;

  let res: Response;
  try {
    res = await fetch(fullUrl, fetchInit);
  } catch (cause) {
    throw new NetworkError({ cause });
  }

  if (!res.ok) {
    const err = await parseError(res);
    if (err instanceof AuthFailureError) {
      _authFailureHandler?.(window.location.pathname + window.location.search);
    }
    throw err;
  }

  // 204 No Content — Orval wrapper expects an object, hand-written shape
  // expects undefined.
  if (res.status === 204) {
    return (
      orvalShape
        ? ({ data: undefined, status: 204, headers: res.headers } as unknown as T)
        : (undefined as T)
    );
  }

  const ct = res.headers.get('content-type');
  let parsed: unknown;
  if (ct !== null && (ct.includes('application/json') || isProblemContentType(ct))) {
    try {
      parsed = await res.json();
    } catch (cause) {
      throw new ApiError('Failed to parse response JSON', { cause });
    }
  } else {
    parsed = await res.text();
  }

  if (orvalShape) {
    return { data: parsed, status: res.status, headers: res.headers } as unknown as T;
  }
  return parsed as T;
}
