import { createBrowserHistory, createRouter } from '@tanstack/react-router';
import { routeTree } from '../routeTree.gen';
import { RouteSkeleton } from '@/components/route-skeleton';

export const router = createRouter({
  routeTree,
  history: createBrowserHistory(),
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
  defaultPendingMs: 200,
  defaultPendingComponent: RouteSkeleton,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
