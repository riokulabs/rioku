import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangleIcon,
  TrashIcon,
  KeyIcon,
  EyeOffIcon,
  BombIcon,
} from 'lucide-react'

import { apiClient } from '@/lib/api'
import { TypedConfirmationDialog } from '@/components/rioku/typed-confirmation-dialog'

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface DangerAction {
  id: string
  titleKey: string
  descriptionKey: string
  phraseKey: string
  icon: React.ElementType
  endpoint: string
}

const dangerActions: DangerAction[] = [
  {
    id: 'reset-config',
    titleKey: 'dangerZone.resetConfig',
    descriptionKey: 'dangerZone.resetConfigDescription',
    phraseKey: 'dangerZone.resetConfigPhrase',
    icon: TrashIcon,
    endpoint: '/danger/reset-config',
  },
  {
    id: 'rotate-token',
    titleKey: 'dangerZone.rotateToken',
    descriptionKey: 'dangerZone.rotateTokenDescription',
    phraseKey: 'dangerZone.rotateTokenPhrase',
    icon: KeyIcon,
    endpoint: '/danger/rotate-token',
  },
  {
    id: 'purge-traces',
    titleKey: 'dangerZone.purgeTraces',
    descriptionKey: 'dangerZone.purgeTracesDescription',
    phraseKey: 'dangerZone.purgeTracesPhrase',
    icon: EyeOffIcon,
    endpoint: '/danger/purge-traces',
  },
  {
    id: 'factory-reset',
    titleKey: 'dangerZone.factoryReset',
    descriptionKey: 'dangerZone.factoryResetDescription',
    phraseKey: 'dangerZone.factoryResetPhrase',
    icon: BombIcon,
    endpoint: '/danger/factory-reset',
  },
]

export const Route = createFileRoute('/settings/danger-zone')({
  component: DangerZonePage,
})

function DangerZonePage() {
  const { t } = useTranslation('settings')
  const [activeAction, setActiveAction] = useState<DangerAction | null>(null)

  const dangerMutation = useMutation({
    mutationFn: (endpoint: string) => apiClient.post(endpoint),
    onSuccess: () => {
      toast.success('Action completed')
      setActiveAction(null)
    },
    onError: () =>
      toast.error('Action failed (backend endpoint not yet available)'),
  })

  return (
    <div className="space-y-6">
      <Card className="border-red-500/30 dark:border-red-500/20">
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertTriangleIcon className="size-5 text-red-500" />
            <CardTitle className="text-red-600 dark:text-red-400">
              {t('dangerZone.title')}
            </CardTitle>
          </div>
          <CardDescription>{t('dangerZone.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {dangerActions.map((action) => {
            const Icon = action.icon
            return (
              <div
                key={action.id}
                className="flex items-center justify-between rounded-lg border border-red-500/20 bg-red-500/5 p-4"
              >
                <div className="flex items-start gap-3">
                  <Icon className="size-5 text-red-500 mt-0.5 shrink-0" />
                  <div>
                    <h4 className="text-sm font-semibold text-red-600 dark:text-red-400">
                      {t(action.titleKey)}
                    </h4>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {t(action.descriptionKey)}
                    </p>
                  </div>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setActiveAction(action)}
                  className="shrink-0 ml-4"
                >
                  {t(action.titleKey)}
                </Button>
              </div>
            )
          })}
        </CardContent>
      </Card>

      {activeAction && (
        <TypedConfirmationDialog
          open={activeAction !== null}
          onOpenChange={(open) => {
            if (!open) setActiveAction(null)
          }}
          title={t(activeAction.titleKey)}
          description={t(activeAction.descriptionKey)}
          confirmPhrase={t(activeAction.phraseKey)}
          confirmLabel={t(activeAction.titleKey)}
          onConfirm={() => dangerMutation.mutate(activeAction.endpoint)}
          loading={dangerMutation.isPending}
        />
      )}
    </div>
  )
}
