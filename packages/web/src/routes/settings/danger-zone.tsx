import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'

import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@/components/ui/card'

export const Route = createFileRoute('/settings/danger-zone')({
  component: DangerZoneSettings,
})

function DangerZoneSettings() {
  const { t } = useTranslation('settings')

  return (
    <div className="space-y-6">
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-5" />
            {t('nav.dangerZone')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">{t('placeholders.dangerZone')}</p>
        </CardContent>
      </Card>
    </div>
  )
}
