import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Settings, GitBranch, History, FileCode, Puzzle } from 'lucide-react'

import { PageHeader } from '@/components/rioku/page-header'
import { DataTable } from '@/components/rioku/data-table'
import { CodeBlock } from '@/components/rioku/code-block'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { apiClient, type PluginDetail, type PluginConfig } from '@/lib/api'

export const Route = createFileRoute('/plugins/$pluginId')({
  component: PluginDetailPage,
})

function PluginDetailPage() {
  const { pluginId } = Route.useParams()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('config')

  const { data: plugin, isLoading } = useQuery<PluginDetail>({
    queryKey: ['plugins', pluginId],
    queryFn: () => apiClient.get<PluginDetail>(`/plugins/${pluginId}`),
  })

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }

  if (!plugin) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: '/plugins' })}>
          <ArrowLeft className="size-3.5" data-icon="inline-start" />
          Back to Plugins
        </Button>
        <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed p-12 text-center">
          <Puzzle className="size-8 text-muted-foreground" />
          <h2 className="text-lg font-medium">Plugin Unavailable</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            This page is provided by the <strong>{pluginId}</strong> plugin,
            which is currently disabled or not installed.
          </p>
          <Button variant="outline" onClick={() => navigate({ to: '/plugins' })}>
            Back to Plugins
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate({ to: '/plugins' })}>
        <ArrowLeft className="size-3.5" data-icon="inline-start" />
        Back to Plugins
      </Button>

      <PageHeader
        title={plugin.name}
        description={plugin.description}
        actions={
          <div className="flex items-center gap-3">
            <Badge variant={plugin.status === 'active' ? 'default' : 'secondary'}>
              {plugin.status}
            </Badge>
            <Badge variant="outline">{plugin.version}</Badge>
          </div>
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="config">
            <Settings className="mr-1.5 size-3.5" />
            Configuration
          </TabsTrigger>
          <TabsTrigger value="routes">
            <GitBranch className="mr-1.5 size-3.5" />
            Dependent Routes
          </TabsTrigger>
          <TabsTrigger value="changelog">
            <History className="mr-1.5 size-3.5" />
            Changelog
          </TabsTrigger>
          <TabsTrigger value="raw">
            <FileCode className="mr-1.5 size-3.5" />
            YAML/JSON
          </TabsTrigger>
        </TabsList>

        {/* Configuration tab */}
        <TabsContent value="config">
          <Card>
            <CardHeader>
              <CardTitle>Plugin Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {plugin.config.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  This plugin has no configurable options.
                </p>
              ) : (
                plugin.config.map((field) => (
                  <ConfigField key={field.key} field={field} />
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Dependent Routes tab */}
        <TabsContent value="routes">
          <DataTable
            title="Routes using this plugin"
            columns={[
              {
                key: 'routeName',
                header: 'Route',
                render: (row) => (
                  <span className="font-mono text-primary hover:underline">
                    {row.routeName as string}
                  </span>
                ),
              },
              {
                key: 'routeId',
                header: 'Route ID',
                render: (row) => (
                  <span className="font-mono text-xs text-muted-foreground">
                    {row.routeId as string}
                  </span>
                ),
              },
              {
                key: 'policyId',
                header: 'Policy',
                render: (row) =>
                  row.policyId ? (
                    <span className="font-mono text-xs">{row.policyId as string}</span>
                  ) : (
                    <span className="text-muted-foreground">--</span>
                  ),
              },
            ]}
            data={plugin.dependentRoutes as unknown as Record<string, unknown>[]}
            pageSize={20}
          />
        </TabsContent>

        {/* Changelog tab */}
        <TabsContent value="changelog">
          <div className="space-y-4">
            {plugin.changelog.length === 0 ? (
              <p className="text-sm text-muted-foreground">No changelog entries.</p>
            ) : (
              plugin.changelog.map((entry) => (
                <Card key={entry.version}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Badge variant="outline">{entry.version}</Badge>
                      <span className="text-muted-foreground">{entry.date}</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="list-disc space-y-1 pl-4 text-sm">
                      {entry.changes.map((change, i) => (
                        <li key={i}>{change}</li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        {/* YAML/JSON tab */}
        <TabsContent value="raw">
          <CodeBlock value={plugin.rawConfig} language="json" />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function ConfigField({ field }: { field: PluginConfig }) {
  switch (field.type) {
    case 'boolean':
      return (
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label>{field.label}</Label>
            {field.description && (
              <p className="text-xs text-muted-foreground">{field.description}</p>
            )}
          </div>
          <Switch checked={field.value as boolean} />
        </div>
      )
    case 'select':
      return (
        <div className="space-y-1.5">
          <Label>{field.label}</Label>
          {field.description && (
            <p className="text-xs text-muted-foreground">{field.description}</p>
          )}
          <Select value={String(field.value)}>
            <SelectTrigger size="sm" className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(field.options ?? []).map((opt) => (
                <SelectItem key={opt} value={opt}>{opt}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )
    case 'number':
      return (
        <div className="space-y-1.5">
          <Label>{field.label}</Label>
          {field.description && (
            <p className="text-xs text-muted-foreground">{field.description}</p>
          )}
          <Input type="number" value={String(field.value)} className="w-64" />
        </div>
      )
    default:
      return (
        <div className="space-y-1.5">
          <Label>{field.label}</Label>
          {field.description && (
            <p className="text-xs text-muted-foreground">{field.description}</p>
          )}
          <Input value={String(field.value)} className="w-64" />
        </div>
      )
  }
}
