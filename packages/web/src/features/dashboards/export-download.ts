/**
 * Shared helper for triggering a dashboard JSON download.
 *
 * Used by the viewer's header button, the builder's header button, and
 * anywhere else we surface "Export JSON" actions. Keeping the filename
 * convention in a single place means every caller gets the same
 * `dashboard-<slug>-v<version>.json` shape.
 */
import type { Dashboard } from '@/api/resources';
import { exportDashboardJson } from './api';

function kebab(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Trigger a browser download of the dashboard's export payload as JSON.
 * The version tag was previously suffixed via a mock-store snapshot of
 * `dashboardVersions`. With the dashboards feature still on the
 * mock-mode backend, the SPA does not have a live versions stream;
 * exports drop the tag until a real `/dashboards/{id}/versions` endpoint
 * lands and `useDashboardVersions` becomes a daemon query.
 */
export function downloadDashboardExport(dashboard: Dashboard): void {
  const payload = exportDashboardJson(dashboard.id);
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const slug = kebab(dashboard.name) || 'dashboard';
  const link = document.createElement('a');
  link.href = url;
  link.download = `dashboard-${slug}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
