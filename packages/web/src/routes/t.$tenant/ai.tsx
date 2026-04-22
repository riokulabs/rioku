/**
 * AI section layout route.
 * Renders a simple outlet — the app shell handles the sidebar navigation.
 */
import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/t/$tenant/ai')({
  component: () => <Outlet />,
});
