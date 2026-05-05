/**
 * TEMPORARY shim during Stage-2 migration. Delegates the old `apiClient.get/post/...`
 * surface to the new mutator. Each parallel plan retires its feature's apiClient
 * usage; Plan 13 close-out asserts this file has zero importers and deletes it.
 */
import { customFetch } from './mutator';

export const apiClient = {
  get<T>(path: string, options?: { signal?: AbortSignal }): Promise<T> {
    return customFetch<T>({ method: 'GET', url: path, signal: options?.signal });
  },
  post<T>(path: string, body?: unknown, options?: { signal?: AbortSignal }): Promise<T> {
    return customFetch<T>({ method: 'POST', url: path, data: body, signal: options?.signal });
  },
  put<T>(path: string, body?: unknown, options?: { signal?: AbortSignal }): Promise<T> {
    return customFetch<T>({ method: 'PUT', url: path, data: body, signal: options?.signal });
  },
  patch<T>(path: string, body?: unknown, options?: { signal?: AbortSignal }): Promise<T> {
    return customFetch<T>({ method: 'PATCH', url: path, data: body, signal: options?.signal });
  },
  delete<T>(path: string, options?: { signal?: AbortSignal }): Promise<T> {
    return customFetch<T>({ method: 'DELETE', url: path, signal: options?.signal });
  },
};
