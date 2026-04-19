/**
 * /t/$tenant/settings — tenant settings page.
 *
 * Individual sections apply finer guards in later plans.
 * Current guard: tenant:switch (all authenticated members can view).
 *
 * Task 1d.79
 */
import { createFileRoute } from '@tanstack/react-router';
import { requirePermissions } from '@/hooks/use-before-load';
import { SettingsLayout } from '@/features/settings';

export const Route = createFileRoute('/t/$tenant/settings')({
  beforeLoad: requirePermissions({ required: ['tenant:switch'] }),
  component: SettingsLayout,
  validateSearch: (search: Record<string, unknown>) => ({
    section: typeof search.section === 'string' ? search.section : undefined,
  }),
});
