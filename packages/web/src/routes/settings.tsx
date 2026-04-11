import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { PageHeader } from '@/components/rioku/page-header'
import { SettingsLayout } from '@/components/layout/settings-layout'

export const Route = createFileRoute('/settings')({
  beforeLoad: ({ location }) => {
    if (location.pathname === '/settings') {
      throw redirect({ to: '/settings/general' })
    }
  },
  component: SettingsRoute,
})

function SettingsRoute() {
  const { t } = useTranslation('settings')

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('subtitle')} />
      <SettingsLayout>
        <Outlet />
      </SettingsLayout>
    </div>
  )
}
