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
import { WizardStepIndicator } from '@/components/rioku/wizard-step-indicator'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

import { YamlJsonEditor } from '@rioku/ui'
import { policyConfigToYaml, yamlToPolicyConfig } from '@/lib/form-yaml-sync'

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

  const WIZARD_STEPS = ['Type Selection', 'Configuration', 'Review']

  const [mode, setMode] = useState<'form' | 'wizard' | 'code'>('form')
  const [wizardStep, setWizardStep] = useState(0)
  const [yamlContent, setYamlContent] = useState('')
  const [yamlFormat, setYamlFormat] = useState<'yaml' | 'json'>('yaml')

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

      {/* Mode toggle */}
      <div className="flex items-center gap-2">
        <Button
          variant={mode === 'form' ? 'default' : 'outline'}
          size="sm"
          onClick={() => {
            if (mode === 'code') {
              const parsed = yamlToPolicyConfig(yamlContent)
              if (parsed.type) setSelectedType(parsed.type)
              if (parsed.name) setName(parsed.name)
              setConfig(parsed.config)
            }
            setMode('form')
          }}
        >
          {t('create.formMode', 'Form')}
        </Button>
        <Button
          variant={mode === 'wizard' ? 'default' : 'outline'}
          size="sm"
          onClick={() => {
            if (mode === 'code') {
              const parsed = yamlToPolicyConfig(yamlContent)
              if (parsed.type) setSelectedType(parsed.type)
              if (parsed.name) setName(parsed.name)
              setConfig(parsed.config)
            }
            setWizardStep(0)
            setMode('wizard')
          }}
        >
          {t('create.wizardMode', 'Wizard')}
        </Button>
        <Button
          variant={mode === 'code' ? 'default' : 'outline'}
          size="sm"
          onClick={() => {
            if ((mode === 'form' || mode === 'wizard') && selectedType) {
              setYamlContent(policyConfigToYaml(selectedType, name, config))
            }
            setMode('code')
          }}
        >
          {t('create.codeMode', 'YAML')}
        </Button>
      </div>

      {mode === 'form' && (
        <>
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
        </>
      )}

      {mode === 'wizard' && (
        <div className="space-y-6">
          <WizardStepIndicator steps={WIZARD_STEPS} currentStep={wizardStep} />

          {wizardStep === 0 && (
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
          )}

          {wizardStep === 1 && selectedType && (
            <Card>
              <CardHeader>
                <CardTitle>{t('create.configuration')}</CardTitle>
                <p className="text-sm text-muted-foreground">Configure the policy behavior.</p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="wiz-policy-name">{t('create.policyName')}</Label>
                  <Input
                    id="wiz-policy-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('create.policyNamePlaceholder')}
                  />
                </div>
                <PolicyFormForType
                  type={selectedType}
                  value={config}
                  onChange={setConfig}
                  errors={errors}
                />
              </CardContent>
            </Card>
          )}

          {wizardStep === 2 && (
            <Card>
              <CardHeader>
                <CardTitle>Review Policy Configuration</CardTitle>
                <p className="text-sm text-muted-foreground">Verify the settings below before creating this policy.</p>
              </CardHeader>
              <CardContent>
                <div className="divide-y divide-border/50">
                  <div className="grid grid-cols-[180px_1fr] gap-4 py-3">
                    <span className="text-sm text-muted-foreground">Name</span>
                    <span className="text-sm">{name || '(not set)'}</span>
                  </div>
                  <div className="grid grid-cols-[180px_1fr] gap-4 py-3">
                    <span className="text-sm text-muted-foreground">Type</span>
                    <span className="text-sm">{TYPE_OPTIONS.find((opt) => opt.value === selectedType)?.label ?? selectedType}</span>
                  </div>
                  {Object.entries(config).map(([key, value]) => (
                    <div key={key} className="grid grid-cols-[180px_1fr] gap-4 py-3">
                      <span className="text-sm text-muted-foreground">{key}</span>
                      <span className="text-sm">{String(value)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Wizard navigation */}
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              onClick={() => setWizardStep((s) => Math.max(0, s - 1))}
              disabled={wizardStep === 0}
            >
              Back
            </Button>
            {wizardStep === WIZARD_STEPS.length - 1 ? (
              <Button onClick={handleSave} disabled={createMutation.isPending || !name.trim() || !selectedType}>
                {createMutation.isPending ? 'Creating...' : t('create.save')}
              </Button>
            ) : (
              <Button
                onClick={() => setWizardStep((s) => Math.min(WIZARD_STEPS.length - 1, s + 1))}
                disabled={wizardStep === 0 && !selectedType}
              >
                Continue
              </Button>
            )}
          </div>
        </div>
      )}

      {mode === 'code' && (
        <Card>
          <CardContent className="pt-6">
            <p className="mb-3 text-sm text-muted-foreground">
              Edit the policy configuration in YAML or JSON format. The type, name, and config fields are all editable.
            </p>
            <YamlJsonEditor
              value={yamlContent}
              onChange={setYamlContent}
              format={yamlFormat}
              onFormatChange={setYamlFormat}
              height="400px"
              showDownload
              downloadFilename="policy"
            />
          </CardContent>
        </Card>
      )}

      {/* Actions (shown for form and code modes; wizard has its own nav) */}
      {mode !== 'wizard' && (
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
      )}
    </div>
  )
}
