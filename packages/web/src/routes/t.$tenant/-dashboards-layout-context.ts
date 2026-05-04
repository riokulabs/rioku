/**
 * Stable React context for the dashboards layout. Lives in its own module so
 * Vite HMR doesn't reset the context identity each time `dashboards.tsx`
 * reloads — which would orphan child routes mounted via <Outlet />.
 */
import { createContext, useContext } from 'react';
import type { Dashboard } from '@/features/dashboards/types';

export interface DashboardsRouteContext {
  /** Open the delete-dashboard confirmation modal for a given dashboard. */
  openDelete: (dashboard: Dashboard) => void;
}

export const DashboardsLayoutContext = createContext<DashboardsRouteContext | null>(null);

export function useDashboardsLayoutContext(): DashboardsRouteContext {
  const ctx = useContext(DashboardsLayoutContext);
  if (!ctx) {
    throw new Error('useDashboardsLayoutContext must be used inside the dashboards layout');
  }
  return ctx;
}
