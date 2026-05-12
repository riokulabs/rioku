/**
 * TEMPORARY shim. Delegates the old `apiClient.get/post/...` surface to the
 * new mutator. Slated for deletion once all importers are migrated.
 */
import { customFetch } from './mutator';

export const apiClient = {
  get<T>(path: string, options?: { signal?: AbortSignal }): Promise<T> {
    return customFetch<T>({
      method: 'GET',
      url: path,
      ...(options?.signal !== undefined && { signal: options.signal }),
    });
  },
  post<T>(path: string, body?: unknown, options?: { signal?: AbortSignal }): Promise<T> {
    return customFetch<T>({
      method: 'POST',
      url: path,
      ...(body !== undefined && { data: body }),
      ...(options?.signal !== undefined && { signal: options.signal }),
    });
  },
  put<T>(path: string, body?: unknown, options?: { signal?: AbortSignal }): Promise<T> {
    return customFetch<T>({
      method: 'PUT',
      url: path,
      ...(body !== undefined && { data: body }),
      ...(options?.signal !== undefined && { signal: options.signal }),
    });
  },
  patch<T>(path: string, body?: unknown, options?: { signal?: AbortSignal }): Promise<T> {
    return customFetch<T>({
      method: 'PATCH',
      url: path,
      ...(body !== undefined && { data: body }),
      ...(options?.signal !== undefined && { signal: options.signal }),
    });
  },
  delete<T>(path: string, options?: { signal?: AbortSignal }): Promise<T> {
    return customFetch<T>({
      method: 'DELETE',
      url: path,
      ...(options?.signal !== undefined && { signal: options.signal }),
    });
  },
};
