import { RouterProvider } from '@tanstack/react-router';
import { Providers } from './providers';
import { router } from './router';
import { DevSideload } from './dev-sideload';

export function App() {
  return (
    <Providers>
      {/* Dev-mode plugin sideload: renders nothing, runs once on mount in DEV only */}
      <DevSideload />
      <RouterProvider router={router} />
    </Providers>
  );
}
