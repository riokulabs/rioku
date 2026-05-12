import { createBrowserHistory, createRouter } from '@tanstack/react-router';
import { routeTree } from '../routeTree.gen';
import { RouteSkeleton } from '@/components/route-skeleton';
import { queryClient } from '@/api/query-client';

export const router = createRouter({
  routeTree,
  history: createBrowserHistory(),
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
  defaultPendingMs: 200,
  defaultPendingComponent: RouteSkeleton,
  context: { queryClient },
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
