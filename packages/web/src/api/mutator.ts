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
 * Supports two calling styles:
 *   1. Object form (legacy): customFetch({ url, method, data, signal, params })
 *      → returns the parsed body (T).
 *   2. Fetch form (Orval-generated): customFetch(url, RequestInit)
 *      → returns `{ data, status, headers }` so generated clients can read
 *      response metadata.
 */
export async function customFetch<T>(args: CustomFetchArgs): Promise<T>;
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export async function customFetch<T>(
  url: string,
  init: RequestInit,
): Promise<{ data: T; status: number; headers: Headers }>;
export async function customFetch<T>(
  argsOrUrl: CustomFetchArgs | string,
  maybeInit?: RequestInit,
): Promise<unknown> {
  // Form 2: (url, init) — used by Orval-generated clients.
  if (typeof argsOrUrl === 'string') {
    return _orvalFetch<T>(argsOrUrl, maybeInit ?? {});
  }
  // Form 1: object args — legacy in-feature callers.
  const { url, method, data, signal, params } = argsOrUrl;

  let fullUrl = url.startsWith('http') ? url : `${BASE}${url}`;
  if (params !== undefined && Object.keys(params).length > 0) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) qs.set(k, String(v));
    }
    fullUrl = `${fullUrl}${fullUrl.includes('?') ? '&' : '?'}${qs.toString()}`;
  }

  const headers: Record<string, string> = {};
  const fetchInit: RequestInit = {
    method,
    headers,
    credentials: 'include',
  };
  if (data !== undefined) {
    headers['content-type'] = 'application/json';
    fetchInit.body = JSON.stringify(data);
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

  if (res.status === 204) return undefined as T;

  const ct = res.headers.get('content-type');
  if (ct !== null && (ct.includes('application/json') || isProblemContentType(ct))) {
    try {
      return (await res.json()) as T;
    } catch (cause) {
      throw new ApiError('Failed to parse response JSON', { cause });
    }
  }
  return (await res.text()) as T;
}

/**
 * Orval-style fetch: takes (url, RequestInit) and returns the response with
 * data/status/headers. Used by generated clients in `src/api/generated/`.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
async function _orvalFetch<T>(
  url: string,
  init: RequestInit,
): Promise<{ data: T; status: number; headers: Headers }> {
  const fullUrl = url.startsWith('http') ? url : `${BASE}${url}`;
  const headers = new Headers(init.headers ?? {});
  if (init.body !== undefined && init.body !== null && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  let res: Response;
  try {
    res = await fetch(fullUrl, {
      ...init,
      headers,
      credentials: init.credentials ?? 'include',
    });
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
  let data: unknown = undefined;
  if (res.status !== 204) {
    const ct = res.headers.get('content-type');
    if (ct !== null && (ct.includes('application/json') || isProblemContentType(ct))) {
      try {
        data = await res.json();
      } catch (cause) {
        throw new ApiError('Failed to parse response JSON', { cause });
      }
    } else {
      data = await res.text();
    }
  }
  return { data: data as T, status: res.status, headers: res.headers };
}
