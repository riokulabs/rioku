import type { ReactNode } from 'react';
import { AppShell } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useLocation, useParams } from '@tanstack/react-router';
import { TopBar } from '@/components/app-shell/top-bar';
import { Sidebar } from '@/components/app-shell/sidebar';
import { activeSectionFor } from '@/components/app-shell/nav-tree';
import { useSidebarEntries } from '@/hooks/use-sidebar-entries';
import { KeyboardShortcutsHelp } from '@/components/keyboard-shortcuts-help';
import { Zone } from '@/components/zone';
import { ImpersonationBanner } from './impersonation-banner';

// Main nav (rail) has two widths: icons-only (collapsed) vs icons + labels
// (expanded). The sub-menu panel renders alongside when the active section
// has children; otherwise the rail fills the sidebar on its own.
const RAIL_COLLAPSED_WIDTH = 60;
const RAIL_EXPANDED_WIDTH = 190;
const PANEL_WIDTH = 220;

export function AppLayout({ children }: { children: ReactNode }) {
  const [navOpened, { toggle: toggleNav, close: closeNav }] = useDisclosure(false);
  // Default to "icons only" — the refined rail is iconographic by default,
  // users opt in to labels via the collapse toggle.
  const [navDesktopExpanded, { toggle: toggleNavDesktop }] = useDisclosure(false);

  const location = useLocation();
  const { tenant: tenantSlug = 'acme' } = useParams({ strict: false });
  const pluginEntries = useSidebarEntries('plugins');

  const pathSuffix = extractSuffix(location.pathname, tenantSlug);
  const active = activeSectionFor(pathSuffix);
  const pluginEntriesForActive = active.id === 'system' ? pluginEntries : [];
  const hasChildren =
    (active.children !== undefined && active.children.length > 0) ||
    pluginEntriesForActive.length > 0;

  const railWidth = navDesktopExpanded ? RAIL_EXPANDED_WIDTH : RAIL_COLLAPSED_WIDTH;
  const navbarWidth = hasChildren ? railWidth + PANEL_WIDTH : railWidth;

  return (
    <>
      {/* Impersonation banner is sticky-top, outside AppShell so it is always visible */}
      <ImpersonationBanner />
      <AppShell
        header={{ height: 56 }}
        navbar={{
          width: navbarWidth,
          breakpoint: 'sm',
          collapsed: { mobile: !navOpened, desktop: false },
        }}
        padding="md"
      >
        <AppShell.Header>
          <TopBar navOpened={navOpened} onNavToggle={toggleNav} />
        </AppShell.Header>
        <AppShell.Navbar>
          <Sidebar
            collapsed={!navDesktopExpanded}
            onToggleCollapsed={toggleNavDesktop}
            onNavLinkClick={closeNav}
          />
        </AppShell.Navbar>
        <AppShell.Main>{children}</AppShell.Main>
        <KeyboardShortcutsHelp />
      </AppShell>
      {/* Zone: global.bottom-banner — plugins can inject sticky bottom banners */}
      <Zone id="global.bottom-banner" />
    </>
  );
}

function extractSuffix(pathname: string, tenantSlug: string): string {
  const prefix = `/t/${tenantSlug}/`;
  if (pathname.startsWith(prefix)) return pathname.slice(prefix.length);
  return pathname.replace(/^\/+/, '');
}
