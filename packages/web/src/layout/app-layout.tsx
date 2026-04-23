import type { ReactNode } from 'react';
import { AppShell } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { TopBar } from '@/components/app-shell/top-bar';
import { Sidebar } from '@/components/app-shell/sidebar';
import { KeyboardShortcutsHelp } from '@/components/keyboard-shortcuts-help';
import { Zone } from '@/components/zone';
import { ImpersonationBanner } from './impersonation-banner';

// The sidebar is a composite: a 60px icon rail + an optional 220px section
// panel. When "collapsed" we hide only the panel; the rail is always visible
// on desktop. Mobile still fully-hides the navbar via AppShell.
const RAIL_WIDTH = 60;
const PANEL_WIDTH = 220;
const NAVBAR_EXPANDED_WIDTH = RAIL_WIDTH + PANEL_WIDTH;
const NAVBAR_COLLAPSED_WIDTH = RAIL_WIDTH;

export function AppLayout({ children }: { children: ReactNode }) {
  const [navOpened, { toggle: toggleNav, close: closeNav }] = useDisclosure(false);
  const [navDesktopOpened, { toggle: toggleNavDesktop }] = useDisclosure(true);

  return (
    <>
      {/* Impersonation banner is sticky-top, outside AppShell so it is always visible */}
      <ImpersonationBanner />
      <AppShell
        header={{ height: 56 }}
        navbar={{
          width: navDesktopOpened ? NAVBAR_EXPANDED_WIDTH : NAVBAR_COLLAPSED_WIDTH,
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
            collapsed={!navDesktopOpened}
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
