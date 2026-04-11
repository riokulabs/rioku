import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

export const Route = createFileRoute('/settings/observability')({
  component: ObservabilitySettings,
})

function ObservabilitySettings() {
  const { t } = useTranslation('settings')

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">{t('nav.observability')}</h2>
      <p className="text-muted-foreground">{t('placeholders.observability')}</p>
    </div>
  )
}
