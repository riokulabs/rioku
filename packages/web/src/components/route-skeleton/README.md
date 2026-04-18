# `<RouteSkeleton>`

A loading placeholder shown during route transitions, wired into TanStack Router as the `defaultPendingComponent`.

## What it is

- Renders a Mantine `<Skeleton>` composition shaped like a typical page: one wide header bar followed by three body rows of decreasing widths.
- Only visible when a route's loader takes longer than `defaultPendingMs` (200 ms).
- Registered globally via `router.tsx` `defaultPendingComponent` — individual routes can override it with a more specific skeleton.

## What it is not for

- It is not a content-area skeleton for lazy-loaded data after the route mounts — use inline `<Skeleton>` or a data-level loading state for that.
- It is not a spinner/progress bar — use `@mantine/nprogress` (`NavigationProgress`) for that.
- Do not import or render it manually inside route components.
