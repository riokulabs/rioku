import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  ArrowLeftIcon,
  GaugeIcon,
  ShieldCheckIcon,
  KeyIcon,
  GlobeIcon,
  ZapOffIcon,
  ArrowUpDownIcon,
  DatabaseIcon,
  RefreshCwIcon,
} from 'lucide-react'

import { apiClient } from '@/lib/api'
import type { Policy } from '@/lib/api'
import { policySchemaFor } from '@/lib/schemas/policy-schemas'
import { TypeSelectorTiles } from '@/components/rioku/type-selector-tiles'
import { PolicyFormForType } from '@/components/rioku/policy-forms'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const Route = createFileRoute('/config/policies/create')({
  component: PolicyCreatePage,
})

const TYPE_OPTIONS = [
  { value: 'POLICY_TYPE_RATE_LIMIT', label: 'Rate Limit', description: 'Limit request rate by IP, API key, or agent', icon: <GaugeIcon className="size-6" /> },
  { value: 'POLICY_TYPE_AUTHENTICATION', label: 'Auth (JWT)', description: 'Validate JWT Bearer tokens', icon: <ShieldCheckIcon className="size-6" /> },
  { value: 'POLICY_TYPE_AUTH_API_KEY', label: 'Auth (API Key)', description: 'Validate API keys in headers or query', icon: <KeyIcon className="size-6" /> },
  { value: 'POLICY_TYPE_CORS', label: 'CORS', description: 'Cross-origin resource sharing rules', icon: <GlobeIcon className="size-6" /> },
  { value: 'POLICY_TYPE_CIRCUIT_BREAKER', label: 'Circuit Breaker', description: 'Stop sending to failing upstreams', icon: <ZapOffIcon className="size-6" /> },
  { value: 'POLICY_TYPE_TRANSFORM', label: 'Transform', description: 'Modify request/response headers and paths', icon: <ArrowUpDownIcon className="size-6" /> },
  { value: 'POLICY_TYPE_CACHE', label: 'Cache', description: 'Cache upstream responses', icon: <DatabaseIcon className="size-6" /> },
  { value: 'POLICY_TYPE_RETRY', label: 'Retry', description: 'Retry failed upstream requests', icon: <RefreshCwIcon className="size-6" /> },
]

export function PolicyCreatePage() {
  const { t } = useTranslation('policies')
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [selectedType, setSelectedType] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [config, setConfig] = useState<Record<string, unknown>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  const createMutation = useMutation({
    mutationFn: (payload: {
      policy: { action: 'UPSERT'; policy: Partial<Policy> }
    }) => apiClient.post('/config', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] })
      toast.success(t('messages.policyCreated'))
      navigate({ to: '/config/policies' })
    },
    onError: () => toast.error('Failed to create policy'),
  })

  function handleSave() {
    if (!selectedType || !name.trim()) return
    const schema = policySchemaFor(selectedType)
    const result = schema.safeParse(config)
    if (!result.success) {
      const fieldErrors: Record<string, string> = {}
      for (const issue of result.error.issues) {
        fieldErrors[issue.path.join('.')] = issue.message
      }
      setErrors(fieldErrors)
      return
    }
    setErrors({})
    createMutation.mutate({
      policy: {
        action: 'UPSERT',
        policy: { name: name.trim(), type: selectedType, config: result.data as Record<string, unknown> },
      },
    })
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <Link
          to="/config/policies"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" />
          {t('create.backToList')}
        </Link>

        <h1 className="text-2xl font-semibold tracking-tight">{t('create.title')}</h1>
      </div>

      {/* Name */}
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-2">
            <Label htmlFor="policy-name">{t('create.policyName')}</Label>
            <Input
              id="policy-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('create.policyNamePlaceholder')}
            />
          </div>
        </CardContent>
      </Card>

      {/* Type selector */}
      <Card>
        <CardHeader>
          <CardTitle>{t('create.selectType')}</CardTitle>
          <p className="text-sm text-muted-foreground">{t('create.selectTypeDesc')}</p>
        </CardHeader>
        <CardContent>
          <TypeSelectorTiles
            options={TYPE_OPTIONS}
            value={selectedType}
            onChange={setSelectedType}
          />
        </CardContent>
      </Card>

      {/* Type-specific form */}
      {selectedType && (
        <Card>
          <CardHeader>
            <CardTitle>{t('create.configuration')}</CardTitle>
          </CardHeader>
          <CardContent>
            <PolicyFormForType
              type={selectedType}
              value={config}
              onChange={setConfig}
              errors={errors}
            />
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Button
          onClick={handleSave}
          disabled={createMutation.isPending || !name.trim() || !selectedType}
        >
          {createMutation.isPending ? 'Creating...' : t('create.save')}
        </Button>
        <Button
          variant="outline"
          render={<Link to="/config/policies" />}
        >
          {t('create.cancel')}
        </Button>
      </div>
    </div>
  )
}
