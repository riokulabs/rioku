/**
 * Settings section layout route.
 * Renders a simple outlet — the app shell handles the sidebar navigation.
 * The index page (/t/$tenant/settings) and sibling subroutes (like
 * /t/$tenant/settings/audit-retention) render inside this outlet.
 */
import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/t/$tenant/settings')({
  component: () => <Outlet />,
});
