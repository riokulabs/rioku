/**
 * Main-sidebar IA — the 7 top-level sections that appear in the rail, plus
 * each section's nested children (rendered in the secondary panel when the
 * user is inside that section or hovers its rail icon).
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
 */
import type { ComponentType } from 'react';
import {
  IconBook,
  IconBrain,
  IconBadge,
  IconBell,
  IconDashboard,
  IconDevices,
  IconFileText,
  IconGauge,
  IconHistory,
  IconKey,
  IconLayoutDashboard,
  IconPlug,
  IconRobot,
  IconRoute,
  IconScale,
  IconServer,
  IconShield,
  IconStack,
  IconTool,
  IconTopologyRing,
  IconRouter,
  IconUsers,
  IconWorld,
} from '@tabler/icons-react';

export interface NavLeaf {
  label: string;
  /** Path suffix after `/t/$tenant/`. */
  suffix: string;
  icon: ComponentType<{ size?: number }>;
}

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
  children?: NavLeaf[];
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
    // No static `children` — the secondary panel is rendered by
    // <AnalyticsNavPanel> which lists dashboards dynamically.
  },
  {
    id: 'apim',
    label: 'API management',
    icon: IconStack,
    defaultRoute: 'services',
    matchPaths: ['services', 'routes', 'policies', 'middlewares', 'api-explorer'],
    children: [
      { label: 'Services', suffix: 'services', icon: IconServer },
      { label: 'Routes', suffix: 'routes', icon: IconRoute },
      { label: 'Policies', suffix: 'policies', icon: IconShield },
      { label: 'Middlewares', suffix: 'middlewares', icon: IconStack },
      { label: 'API Explorer', suffix: 'api-explorer', icon: IconBook },
    ],
  },
  {
    id: 'ai',
    label: 'AI',
    icon: IconBrain,
    defaultRoute: 'ai/providers',
    matchPaths: ['ai', 'security/access-policies'],
    children: [
      { label: 'Providers', suffix: 'ai/providers', icon: IconBrain },
      { label: 'Agents', suffix: 'ai/agents', icon: IconRobot },
      { label: 'Tools', suffix: 'ai/tools', icon: IconTool },
      { label: 'Tool routing', suffix: 'ai/tool-routing', icon: IconRouter },
      { label: 'Rate limits', suffix: 'ai/rate-limits', icon: IconGauge },
      { label: 'Traces', suffix: 'ai/traces', icon: IconHistory },
      { label: 'MCP servers', suffix: 'ai/mcp-servers', icon: IconServer },
      { label: 'Access policies', suffix: 'security/access-policies', icon: IconShield },
    ],
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
    children: [
      { label: 'Users', suffix: 'security/users', icon: IconUsers },
      { label: 'Roles', suffix: 'security/roles', icon: IconBadge },
      { label: 'API keys', suffix: 'security/api-keys', icon: IconKey },
      { label: 'RBAC policies', suffix: 'security/rbac-policies', icon: IconScale },
      { label: 'Sessions', suffix: 'security/sessions', icon: IconDevices },
      { label: 'Audit', suffix: 'security/audit', icon: IconFileText },
    ],
  },
  {
    id: 'system',
    label: 'System',
    icon: IconTopologyRing,
    defaultRoute: 'cluster',
    matchPaths: ['cluster', 'plugins', 'notifications'],
    children: [
      { label: 'Cluster', suffix: 'cluster', icon: IconTopologyRing },
      { label: 'Plugins', suffix: 'plugins', icon: IconPlug },
      { label: 'Notifications', suffix: 'notifications', icon: IconBell },
    ],
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
