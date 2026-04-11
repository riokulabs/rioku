import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Puzzle } from 'lucide-react'

import { PageHeader } from '@/components/rioku/page-header'
import { EmptyState } from '@/components/rioku/empty-state'
import { Slot } from '@/components/plugin/slot'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardAction,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { apiClient } from '@/lib/api'

interface PluginInfo {
  id: string
  name: string
  type: string
  status: 'active' | 'disabled'
  version: string
  description: string
}

export const Route = createFileRoute('/plugins')({
  loader: ({ context }) =>
    context.queryClient
      .ensureQueryData({
        queryKey: ['plugins'],
        queryFn: () => apiClient.get<PluginInfo[]>('/plugins'),
      })
      .catch(() => [] as PluginInfo[]),
  component: Plugins,
})

function Plugins() {
  const { t } = useTranslation('plugins')

  const plugins = Route.useLoaderData() ?? []

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('subtitle')} />

      {plugins.length === 0 ? (
        <EmptyState
          icon={<Puzzle className="size-5" />}
          title={t('empty.noPlugins')}
          description={t('empty.noPluginsDesc')}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {plugins.map((plugin) => (
            <PluginCard key={plugin.id} plugin={plugin} />
          ))}
        </div>
      )}

      {/* Plugin injection zone for settings */}
      <Slot zone="settings.sections" />
    </div>
  )
}

function PluginCard({ plugin }: { plugin: PluginInfo }) {
  const { t } = useTranslation('plugins')
  const navigate = useNavigate()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-mono">{plugin.name}</CardTitle>
        <CardAction>
          <Switch
            checked={plugin.status === 'active'}
            aria-label={`${t('labels.status')}: ${plugin.status}`}
          />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        <CardDescription>{plugin.description}</CardDescription>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant={plugin.status === 'active' ? 'default' : 'secondary'}
            className={
              plugin.status === 'active'
                ? 'bg-green-500/10 text-green-700 dark:text-green-400 border-transparent'
                : ''
            }
          >
            {plugin.status === 'active' ? 'Active' : 'Disabled'}
          </Badge>
          <Badge variant="outline">{plugin.type}</Badge>
          <Badge variant="secondary">{plugin.version}</Badge>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="mt-2 w-full"
          onClick={() => navigate({ to: '/plugins/$pluginId', params: { pluginId: plugin.id } })}
        >
          Configure
        </Button>
      </CardContent>
    </Card>
  )
}
