/**
 * Main-sidebar IA — the 7 top-level sections that appear in the rail.
 *
 * Notes:
 *   - The rail is flat: every top-level section has a single icon.
 *   - Sections with `defaultRoute` navigate there when the rail icon is
 *     clicked; sections without it open the panel but don't navigate.
 *   - `matchPaths` is the list of URL prefixes that keep this section's
 *     panel open ("am I inside this section?"). The first prefix is the
 *     canonical one.
 *   - Settings is intentionally NOT in this tree — it lives only in the
 *     user-card menu.
 *   - Section panel children are driven by the nav-registry (see nav-registry.ts
 *     and nav-bootstrap.ts). Hard-coded child arrays have been removed.
 */
import type { ComponentType } from 'react';
import {
  IconBrain,
  IconDashboard,
  IconLayoutDashboard,
  IconShield,
  IconStack,
  IconTopologyRing,
  IconWorld,
} from '@tabler/icons-react';

export interface NavSection {
  id: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
  /**
   * Suffix of the route to navigate to when the rail icon is clicked.
   * Omit for grouping-only sections (APIM, System) — clicking the icon
   * will open the panel and, if no current child is active, navigate to
   * the first child.
   */
  defaultRoute?: string;
  /**
   * Path suffixes under `/t/$tenant/` that keep this section "active" for
   * the purposes of showing its panel + highlighting the rail icon. Ordered
   * by specificity (most-specific first).
   */
  matchPaths: string[];
}

const DASHBOARD_SECTION: NavSection = {
  id: 'dashboard',
  label: 'Dashboard',
  icon: IconDashboard,
  defaultRoute: 'dashboard',
  matchPaths: ['dashboard'],
};

export const NAV_SECTIONS: NavSection[] = [
  DASHBOARD_SECTION,
  {
    id: 'sites',
    label: 'Sites',
    icon: IconWorld,
    defaultRoute: 'sites',
    matchPaths: ['sites'],
  },
  {
    id: 'analytics',
    label: 'Analytics',
    icon: IconLayoutDashboard,
    defaultRoute: 'dashboards',
    matchPaths: ['dashboards'],
    // No children — the secondary panel is rendered by <AnalyticsNavPanel>
    // which lists dashboards dynamically.
  },
  {
    id: 'apim',
    label: 'API management',
    icon: IconStack,
    defaultRoute: 'services',
    matchPaths: ['services', 'routes', 'policies', 'middlewares', 'api-explorer'],
  },
  {
    id: 'ai',
    label: 'AI',
    icon: IconBrain,
    defaultRoute: 'ai/providers',
    matchPaths: ['ai', 'security/access-policies'],
  },
  {
    id: 'security',
    label: 'Security',
    icon: IconShield,
    defaultRoute: 'security/users',
    // Exclude the AI-owned access-policies prefix from Security's match list
    // so navigating to /security/access-policies keeps the AI panel open.
    matchPaths: [
      'security/users',
      'security/roles',
      'security/api-keys',
      'security/rbac-policies',
      'security/sessions',
      'security/audit',
    ],
  },
  {
    id: 'system',
    label: 'System',
    icon: IconTopologyRing,
    defaultRoute: 'cluster',
    matchPaths: ['cluster', 'plugins', 'notifications'],
  },
];

/**
 * Pick the section whose `matchPaths` matches the current URL. Returns the
 * dashboard section when nothing matches (e.g. on the tenants picker).
 */
export function activeSectionFor(pathSuffix: string): NavSection {
  for (const section of NAV_SECTIONS) {
    for (const m of section.matchPaths) {
      if (pathSuffix === m || pathSuffix.startsWith(`${m}/`)) return section;
    }
  }
  return DASHBOARD_SECTION;
}
