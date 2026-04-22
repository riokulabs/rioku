import type { ReactNode } from 'react';
import { AppShell, Alert } from '@mantine/core';
import { TopBar } from '@/components/app-shell/top-bar';
import { AdminSidebar } from '@/components/app-shell/admin-sidebar';
import { KeyboardShortcutsHelp } from '@/components/keyboard-shortcuts-help';
import { ImpersonationBanner } from './impersonation-banner';

export function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {/* Impersonation banner is conditionally visible — typically the
          super-admin enters a tenant after starting the session, but the
          banner is present in AdminLayout too for edge cases where they
          navigate back to /admin while a session is active. */}
      <ImpersonationBanner />
      <AppShell header={{ height: 56 }} navbar={{ width: 240, breakpoint: 'sm' }} padding="md">
        <AppShell.Header>
          <TopBar />
        </AppShell.Header>
        <AppShell.Navbar>
          <AdminSidebar />
        </AppShell.Navbar>
        <AppShell.Main>
          <Alert color="orange" variant="light" mb="md">
            Super-admin area — all actions logged to `/admin/audit`.
          </Alert>
          {children}
        </AppShell.Main>
        <KeyboardShortcutsHelp />
      </AppShell>
    </>
  );
}
