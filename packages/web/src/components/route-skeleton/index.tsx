import { Stack, Skeleton } from '@mantine/core';

/**
 * Page-shape skeleton shown while a route is loading (TanStack Router
 * `defaultPendingComponent`). Matches a typical page layout:
 *   - One header-height bar (title / breadcrumb area)
 *   - Three body rows of varying widths
 */
export function RouteSkeleton() {
  return (
    <Stack gap="md" p="md">
      {/* Page header */}
      <Skeleton height={32} width="40%" radius="sm" />
      {/* Body rows */}
      <Skeleton height={16} width="90%" radius="sm" />
      <Skeleton height={16} width="75%" radius="sm" />
      <Skeleton height={16} width="55%" radius="sm" />
    </Stack>
  );
}
