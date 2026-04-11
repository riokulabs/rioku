import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

export const Route = createFileRoute('/settings/tls')({
  component: TlsSettings,
})

function TlsSettings() {
  const { t } = useTranslation('settings')

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">{t('nav.tls')}</h2>
      <p className="text-muted-foreground">{t('placeholders.tls')}</p>
    </div>
  )
}
