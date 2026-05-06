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
 * customFetch accepts two call shapes:
 *   1. Project-internal: `customFetch({url, method, data, signal, params})`
 *      — used by hand-written feature code (`features/<x>/api.ts`).
 *   2. Orval-generated: `customFetch(url, RequestInit)` — used by the
 *      generated clients in `src/api/generated/` (Plan 08 onward).
 *
 * The two are identical at the wire level. The function normalises
 * shape (2) into shape (1) before continuing. Generated `RequestInit`
 * carries `method`, optional `headers`, optional `body`, and optional
 * `signal`; we extract those into `CustomFetchArgs` semantics.
 */
export async function customFetch<T>(
  argsOrUrl: CustomFetchArgs | string,
  init?: RequestInit,
): Promise<T> {
  let args: CustomFetchArgs;
  if (typeof argsOrUrl === 'string') {
    let parsedData: unknown;
    if (init?.body !== undefined && init.body !== null) {
      if (typeof init.body === 'string') {
        try {
          parsedData = JSON.parse(init.body);
        } catch {
          parsedData = init.body;
        }
      } else {
        parsedData = init.body;
      }
    }
    args = {
      url: argsOrUrl,
      method: init?.method ?? 'GET',
      ...(parsedData !== undefined ? { data: parsedData } : {}),
      ...(init?.signal ? { signal: init.signal } : {}),
    };
  } else {
    args = argsOrUrl;
  }
  const { url, method, data, signal, params } = args;

  // Project-internal callers pass relative paths (e.g. `/services`) and rely
  // on `BASE` to prepend `/api/v1`. Orval-generated callers pass absolute
  // paths (e.g. `/api/v1/t/{tenant}/dashboards`) — these must NOT be
  // double-prefixed. Detect either an absolute URL or one already rooted
  // at `/api/` and skip the prefix in those cases.
  let fullUrl: string;
  if (url.startsWith('http') || url.startsWith('/api/')) {
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
