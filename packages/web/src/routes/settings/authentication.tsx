import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

export const Route = createFileRoute('/settings/authentication')({
  component: AuthenticationSettings,
})

function AuthenticationSettings() {
  const { t } = useTranslation('settings')

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">{t('nav.authentication')}</h2>
      <p className="text-muted-foreground">{t('placeholders.authentication')}</p>
    </div>
  )
}
