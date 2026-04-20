/**
 * /t/$tenant/settings — tenant settings index page.
 *
 * Renders the section-keyed SettingsLayout. The audit-retention subpage
 * (a sibling file route) is discoverable via the Observability section
 * and via a direct link from the audit page header.
 *
 * Individual sections apply finer guards in later plans.
 * Current guard: tenant:switch (all authenticated members can view).
 */
import { createFileRoute } from '@tanstack/react-router';
import { requirePermissions } from '@/hooks/use-before-load';
import { SettingsLayout } from '@/features/settings';

export const Route = createFileRoute('/t/$tenant/settings/')({
  beforeLoad: requirePermissions({ required: ['tenant:switch'] }),
  component: SettingsLayout,
  validateSearch: (search: Record<string, unknown>) => ({
    section: typeof search.section === 'string' ? search.section : undefined,
  }),
});
