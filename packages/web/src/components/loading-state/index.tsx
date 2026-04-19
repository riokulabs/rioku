import { Stack, Skeleton } from '@mantine/core';

export interface LoadingStateProps {
  /** Number of rows to render (default 5). Used by list and table shapes. */
  rows?: number;
  /** Visual shape of the skeleton layout (default 'list'). */
  shape?: 'list' | 'detail' | 'table';
}

/**
 * LoadingState renders Mantine Skeleton shapes that mirror the in-flight
 * page layout.  Swap out the real content with <LoadingState> while data
 * is being fetched — do NOT use a spinner for full-page loads.
 */
export function LoadingState({ rows = 5, shape = 'list' }: LoadingStateProps) {
  if (shape === 'detail') {
    return (
      <Stack aria-label="Loading" gap="md">
        <Skeleton height={120} radius="sm" />
        <Skeleton height={20} radius="sm" />
        <Skeleton height={20} width="80%" radius="sm" />
        <Skeleton height={20} width="60%" radius="sm" />
      </Stack>
    );
  }

  if (shape === 'table') {
    return (
      <Stack aria-label="Loading" gap="xs">
        {/* Header row */}
        <Skeleton height={36} radius="sm" />
        {/* Body rows */}
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} height={36} radius="sm" />
        ))}
      </Stack>
    );
  }

  // Default: list
  return (
    <Stack aria-label="Loading" gap="xs">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={48} radius="sm" />
      ))}
    </Stack>
  );
}
