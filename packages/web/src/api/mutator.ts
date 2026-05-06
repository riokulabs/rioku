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
 * Two call shapes are supported:
 *
 *   1. The hand-rolled shape `{ url, method, data?, signal?, params? }` used
 *      throughout the admin SPA prior to Orval codegen.
 *   2. The positional `(url, init)` shape that Orval-generated clients use,
 *      where `init` is a `RequestInit` (method/body/headers/signal already
 *      packed in by the caller).
 *
 * Internally both shapes converge on the `{ url, method, ... }` form before
 * issuing the actual fetch. The body/headers from the Orval `init` are
 * forwarded as-is so generated `Content-Type: application/json` + pre-
 * serialised JSON bodies survive the trip.
 */
export async function customFetch<T>(args: CustomFetchArgs): Promise<T>;
export async function customFetch<T>(url: string, init?: RequestInit): Promise<T>;
export async function customFetch<T>(
  argsOrUrl: CustomFetchArgs | string,
  initArg?: RequestInit,
): Promise<T> {
  const { url, method, data, signal, params, init } =
    typeof argsOrUrl === 'string'
      ? {
          url: argsOrUrl,
          method: initArg?.method ?? 'GET',
          data: undefined as unknown,
          signal: initArg?.signal ?? undefined,
          params: undefined,
          init: initArg,
        }
      : { ...argsOrUrl, init: undefined as RequestInit | undefined };

  let fullUrl: string;
  if (url.startsWith('http')) {
    fullUrl = url;
  } else if (url.startsWith('/api/')) {
    // Generated Orval clients already include the /api/v1 prefix in
    // their URL builders; don't double-prepend the base.
    fullUrl = url;
  } else {
    fullUrl = `${BASE}${url}`;
  }
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

  // When called via the Orval positional shape, the body / headers are
  // already packed into `init` — forward them onto the fetch init.
  if (init) {
    if (init.body !== undefined && init.body !== null) fetchInit.body = init.body;
    if (init.headers) {
      const ih = init.headers as Record<string, string>;
      for (const [k, v] of Object.entries(ih)) headers[k.toLowerCase()] = v;
    }
  }

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
