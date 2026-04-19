/**
 * useRiokuMutation — TanStack Query useMutation wrapper with error taxonomy.
 *
 * Maps API errors to appropriate UX responses:
 *   ValidationError → re-throw (let the form show field errors, no toast)
 *   PermissionError → toast "Action denied" + re-throw
 *   NetworkError | ServerError | ApiError → toast with correlationId + re-throw
 *   AuthFailureError → handled by global interceptor (client.ts), not here
 *
 * Lives in hooks/ (not api/) because it calls React hooks (useMutation).
 * A re-export alias is provided in src/api/use-mutation.ts for callers that
 * follow the api/ import convention.
 */

import { useMutation, type UseMutationOptions } from '@tanstack/react-query';
import { notify } from './use-notify';
import {
  ApiError,
  AuthFailureError,
  NetworkError,
  PermissionError,
  ServerError,
  ValidationError,
} from '@/api/errors';

export interface RiokuMutationConfig<TData, TError, TVariables> {
  mutationFn: (variables: TVariables) => Promise<TData>;
  onSuccess?: UseMutationOptions<TData, TError, TVariables>['onSuccess'];
  onError?: UseMutationOptions<TData, TError, TVariables>['onError'];
  /** Forward any other TanStack options verbatim. */
  options?: Omit<
    UseMutationOptions<TData, TError, TVariables>,
    'mutationFn' | 'onSuccess' | 'onError'
  >;
}

function intercept(err: unknown): never {
  // Auth failures are handled by the global interceptor — don't toast.
  if (err instanceof AuthFailureError) throw err;

  // Validation errors: surface to the form, no toast.
  if (err instanceof ValidationError) throw err;

  // Permission errors: toast + re-throw.
  if (err instanceof PermissionError) {
    notify.error('Action denied', 'You do not have permission to perform this action.');
    throw err;
  }

  // Network / server / generic API errors: toast with correlation ID.
  if (
    err instanceof NetworkError ||
    err instanceof ServerError ||
    err instanceof ApiError
  ) {
    notify.error(
      'Request failed',
      err.message,
      err.correlationId ? { correlationId: err.correlationId } : undefined,
    );
    throw err;
  }

  // Unknown error — re-throw without a toast.
  if (err instanceof Error) throw err;
  throw new Error(String(err));
}

export function useRiokuMutation<
  TData = unknown,
  TVariables = void,
  TError = ApiError,
>(config: RiokuMutationConfig<TData, TError, TVariables>) {
  const mutationOptions: UseMutationOptions<TData, TError, TVariables> = {
    ...config.options,
    mutationFn: async (variables) => {
      try {
        return await config.mutationFn(variables);
      } catch (err) {
        intercept(err);
      }
    },
  };
  if (config.onSuccess !== undefined) mutationOptions.onSuccess = config.onSuccess;
  if (config.onError !== undefined) mutationOptions.onError = config.onError;
  return useMutation<TData, TError, TVariables>(mutationOptions);
}
