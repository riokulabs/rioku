import { createBrowserHistory, createRouter } from '@tanstack/react-router';
import { routeTree } from '../routeTree.gen';

export const router = createRouter({
  routeTree,
  history: createBrowserHistory(),
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
