import type { ReactNode } from 'react';
import { AppShell, Alert } from '@mantine/core';
import { TopBar } from '@/components/app-shell/top-bar';
import { AdminSidebar } from '@/components/app-shell/admin-sidebar';
import { KeyboardShortcutsHelp } from '@/components/keyboard-shortcuts-help';

export function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 240, breakpoint: 'sm' }}
      padding="md"
    >
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
  );
}
