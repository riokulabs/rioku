/**
 * Shared helper for triggering a dashboard JSON download.
 *
 * Used by the viewer's header button, the builder's header button, and
 * anywhere else we surface "Export JSON" actions. Keeping the filename
 * convention in a single place means every caller gets the same
 * `dashboard-<slug>-v<version>.json` shape.
 */
import { useMockStore } from '@/api/mock-store';
import type { Dashboard } from '@/api/resources/types';
import { exportDashboardJson } from './api';

function kebab(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Latest version number for the dashboard, or 0 when no versions exist. */
function latestVersion(dashboardId: string): number {
  const versions = useMockStore.getState().dashboardVersions;
  let max = 0;
  for (const v of Object.values(versions)) {
    if (v.dashboard_id === dashboardId && v.version > max) max = v.version;
  }
  return max;
}

/** Trigger a browser download of the dashboard's export payload as JSON. */
export function downloadDashboardExport(dashboard: Dashboard): void {
  const payload = exportDashboardJson(dashboard.id);
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const slug = kebab(dashboard.name) || 'dashboard';
  const version = latestVersion(dashboard.id);
  const versionTag = version > 0 ? `-v${String(version)}` : '';
  const link = document.createElement('a');
  link.href = url;
  link.download = `dashboard-${slug}${versionTag}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
