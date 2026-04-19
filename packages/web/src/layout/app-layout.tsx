import type { ReactNode } from 'react';
import { AppShell } from '@mantine/core';
import { TopBar } from '@/components/app-shell/top-bar';
import { Sidebar } from '@/components/app-shell/sidebar';
import { KeyboardShortcutsHelp } from '@/components/keyboard-shortcuts-help';
import { ImpersonationBanner } from './impersonation-banner';

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {/* Impersonation banner is sticky-top, outside AppShell so it is always visible */}
      <ImpersonationBanner />
      <AppShell
        header={{ height: 56 }}
        navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: true } }}
        padding="md"
      >
        <AppShell.Header>
          <TopBar />
        </AppShell.Header>
        <AppShell.Navbar>
          <Sidebar />
        </AppShell.Navbar>
        <AppShell.Main>{children}</AppShell.Main>
        <KeyboardShortcutsHelp />
      </AppShell>
    </>
  );
}
