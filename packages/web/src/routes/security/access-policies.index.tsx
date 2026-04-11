import { createFileRoute, Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { PlusIcon, ShieldAlertIcon } from 'lucide-react'
import { PageHeader } from '@/components/rioku/page-header'
import { EmptyState } from '@/components/rioku/empty-state'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

export const Route = createFileRoute('/security/access-policies/')({
  component: AccessPoliciesListPage,
})

export function AccessPoliciesListPage() {
  const { t } = useTranslation('access-policies')

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <Button render={<Link to="/security/access-policies/create" />}>
            <PlusIcon className="size-4" />
            {t('list.createPolicy')}
          </Button>
        }
      />

      <EmptyState
        icon={<ShieldAlertIcon className="size-5" />}
        title="Access policies"
        description="Conditional access policies require backend support. Coming soon."
      />
    </div>
  )
}
