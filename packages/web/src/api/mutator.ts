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
 * customFetch supports two calling conventions:
 *
 * 1. Single-object form (hand-written callers):
 *    customFetch({ url, method, data, signal, params })
 *
 * 2. Two-argument form (Orval-generated code):
 *    customFetch(url: string, options: RequestInit & { data?: unknown; params?: Record<...> })
 *
 * Both are normalised internally to the same path.
 */
export async function customFetch<T>(
  argsOrUrl: CustomFetchArgs | string,
  orvalOptions?: RequestInit & {
    data?: unknown;
    params?: Record<string, string | number | boolean | undefined>;
  },
): Promise<T> {
  let url: string;
  let method: string;
  let data: unknown;
  let signal: AbortSignal | undefined;
  let params: Record<string, string | number | boolean | undefined> | undefined;

  if (typeof argsOrUrl === 'string') {
    // Orval two-argument form
    url = argsOrUrl;
    method = (orvalOptions?.method as string | undefined) ?? 'GET';
    data = orvalOptions?.body !== undefined
      ? (typeof orvalOptions.body === 'string' ? JSON.parse(orvalOptions.body) : orvalOptions.body)
      : orvalOptions?.data;
    signal = orvalOptions?.signal ?? undefined;
    params = orvalOptions?.params;
  } else {
    // Single-object form
    ({ url, method, data, signal, params } = argsOrUrl);
  }

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
