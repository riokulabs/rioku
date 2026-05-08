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

let _activeImpersonationIdAccessor: (() => string | null) | null = null;

/**
 * Register an accessor that returns the active super-admin impersonation
 * session id (or null when none is active). When set, the mutator stamps
 * `X-Impersonation-Id` on every daemon-bound request except impersonation-
 * management endpoints (which would otherwise echo the caller's own id).
 *
 * Pass `null` to clear (test cleanup / sign-out).
 */
export function setActiveImpersonationIdAccessor(accessor: (() => string | null) | null): void {
  _activeImpersonationIdAccessor = accessor;
}

function isImpersonationManagementUrl(url: string): boolean {
  return /\/admin\/impersonation(?:[/?#]|$)/.test(url);
}

function applyImpersonationHeader(headers: Record<string, string>, url: string): void {
  if (_activeImpersonationIdAccessor === null) return;
  if (isImpersonationManagementUrl(url)) return;
  // Skip if any casing of the header is already present (explicit override wins).
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === 'x-impersonation-id') return;
  }
  const id = _activeImpersonationIdAccessor();
  if (id === null) return;
  headers['x-impersonation-id'] = id;
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
 * Orval `httpClient: 'fetch'` calls the mutator as
 *   customFetch<{data, status, headers}>(url, RequestInit)
 * and the generated hooks read `.data` from the result. To keep both the
 * legacy `{url, method, data}` callsites and the orval generated callsites
 * working through a single mutator, this function accepts either form.
 */
export interface OrvalFetchResponse<T> {
  data: T;
  status: number;
  headers: Headers;
}

export async function customFetch<T>(args: CustomFetchArgs): Promise<T>;
export async function customFetch<T>(url: string, init?: RequestInit): Promise<T>;
export async function customFetch<T>(
  argsOrUrl: CustomFetchArgs | string,
  init?: RequestInit,
): Promise<T> {
  // Path A — generated orval client: (url, RequestInit) → {data, status, headers}
  if (typeof argsOrUrl === 'string') {
    return runOrvalFetch<T>(argsOrUrl, init);
  }
  // Path B — legacy callers (apiClient shim, use-openapi-spec, use-opaque-filter)
  return runLegacyFetch<T>(argsOrUrl);
}

async function runLegacyFetch<T>(args: CustomFetchArgs): Promise<T> {
  const { url, method, data, signal, params } = args;

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

  applyImpersonationHeader(headers, fullUrl);

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

async function runOrvalFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const fullUrl = url.startsWith('http') ? url : `${BASE}${url.replace(/^\/api\/v1/, '')}`;

  // Use a plain Record so tests can introspect via toMatchObject and to
  // honour explicit caller-supplied casing (e.g. `X-Impersonation-Id`).
  const headersRecord: Record<string, string> = {};
  if (init?.headers !== undefined) {
    if (init.headers instanceof Headers) {
      init.headers.forEach((v, k) => {
        headersRecord[k] = v;
      });
    } else if (Array.isArray(init.headers)) {
      for (const [k, v] of init.headers) headersRecord[k] = v;
    } else {
      Object.assign(headersRecord, init.headers);
    }
  }
  if (init?.body !== undefined) {
    let hasCT = false;
    for (const k of Object.keys(headersRecord)) {
      if (k.toLowerCase() === 'content-type') {
        hasCT = true;
        break;
      }
    }
    if (!hasCT) headersRecord['content-type'] = 'application/json';
  }
  applyImpersonationHeader(headersRecord, fullUrl);
  const fetchInit: RequestInit = {
    ...init,
    headers: headersRecord,
    credentials: init?.credentials ?? 'include',
  };

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

  let data: unknown;
  if (res.status === 204) {
    data = undefined;
  } else {
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

  return { data, status: res.status, headers: res.headers } as T;
}
