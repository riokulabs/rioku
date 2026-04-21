import type { ReactNode } from 'react';
import { AppShell } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { TopBar } from '@/components/app-shell/top-bar';
import { Sidebar } from '@/components/app-shell/sidebar';
import { KeyboardShortcutsHelp } from '@/components/keyboard-shortcuts-help';
import { Zone } from '@/components/zone';
import { ImpersonationBanner } from './impersonation-banner';

export function AppLayout({ children }: { children: ReactNode }) {
  const [navOpened, { toggle: toggleNav, close: closeNav }] = useDisclosure(false);

  return (
    <>
      {/* Impersonation banner is sticky-top, outside AppShell so it is always visible */}
      <ImpersonationBanner />
      <AppShell
        header={{ height: 56 }}
        navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: !navOpened } }}
        padding="md"
      >
        <AppShell.Header>
          <TopBar navOpened={navOpened} onNavToggle={toggleNav} />
        </AppShell.Header>
        <AppShell.Navbar>
          <Sidebar onNavLinkClick={closeNav} />
        </AppShell.Navbar>
        <AppShell.Main>{children}</AppShell.Main>
        <KeyboardShortcutsHelp />
      </AppShell>
      {/* Zone: global.bottom-banner — plugins can inject sticky bottom banners */}
      <Zone id="global.bottom-banner" />
    </>
  );
}
