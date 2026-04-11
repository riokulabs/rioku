import { useState, useCallback } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Ban } from 'lucide-react'

import { PageHeader } from '@/components/rioku/page-header'
import { DataTable } from '@/components/rioku/data-table'
import { StatusBadge, type Status } from '@/components/rioku/status-badge'
import { TimeAgo } from '@/components/rioku/time-ago'
import { ComingSoon } from '@/components/rioku/coming-soon'
import { ConfirmDialog } from '@/components/rioku/confirm-dialog'
import { CodeBlock } from '@/components/rioku/code-block'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { apiClient, type CertificateInfo } from '@/lib/api'
import { features } from '@/lib/feature-flags'

export const Route = createFileRoute('/certificates')({
  component: Certificates,
})

function certStatusToHealth(status: string): Status {
  switch (status) {
    case 'valid': return 'healthy'
    case 'expiring': return 'degraded'
    case 'expired': return 'unhealthy'
    case 'revoked': return 'unhealthy'
    case 'pending': return 'unknown'
    default: return 'unknown'
  }
}

function Certificates() {
  const queryClient = useQueryClient()

  if (!features.certManagement) {
    return (
      <div className="space-y-6">
        <PageHeader title="Certificates" description="Manage TLS certificates" />
        <ComingSoon
          feature="Certificate Management"
          description="Certificate listing, renewal, revocation, and ACME configuration. Requires backend implementation."
        />
      </div>
    )
  }

  const [selectedCert, setSelectedCert] = useState<CertificateInfo | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [confirmRenew, setConfirmRenew] = useState<CertificateInfo | null>(null)
  const [confirmRevoke, setConfirmRevoke] = useState<CertificateInfo | null>(null)

  const { data: certs, isLoading } = useQuery<CertificateInfo[]>({
    queryKey: ['certificates'],
    queryFn: () => apiClient.get<CertificateInfo[]>('/certificates'),
    refetchInterval: 60000,
  })

  const renewMutation = useMutation({
    mutationFn: (certId: string) => apiClient.post(`/certificates/${certId}/renew`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['certificates'] }),
  })

  const revokeMutation = useMutation({
    mutationFn: (certId: string) => apiClient.post(`/certificates/${certId}/revoke`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['certificates'] }),
  })

  const handleRowClick = useCallback((cert: CertificateInfo) => {
    setSelectedCert(cert)
    setDetailOpen(true)
  }, [])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Certificates"
        description="Manage TLS certificates and ACME configuration"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => queryClient.invalidateQueries({ queryKey: ['certificates'] })}
          >
            <RefreshCw className="size-3.5" data-icon="inline-start" />
            Refresh
          </Button>
        }
      />

      <DataTable
        columns={[
          {
            key: 'domain',
            header: 'Domain',
            sortable: true,
            render: (row) => (
              <button
                type="button"
                className="font-mono text-primary hover:underline"
                onClick={() => handleRowClick(row as unknown as CertificateInfo)}
              >
                {row.domain as string}
              </button>
            ),
          },
          {
            key: 'issuer',
            header: 'Issuer',
          },
          {
            key: 'expiresAt',
            header: 'Expires',
            sortable: true,
            render: (row) => <TimeAgo date={row.expiresAt as string} />,
          },
          {
            key: 'status',
            header: 'Status',
            render: (row) => (
              <StatusBadge status={certStatusToHealth(row.status as string)} />
            ),
          },
          {
            key: 'sans',
            header: 'SANs',
            render: (row) => {
              const sans = (row.sans as string[]) ?? []
              return (
                <div className="flex flex-wrap gap-1">
                  {sans.slice(0, 3).map((san) => (
                    <Badge key={san} variant="secondary" className="text-[10px]">
                      {san}
                    </Badge>
                  ))}
                  {sans.length > 3 && (
                    <Badge variant="outline" className="text-[10px]">
                      +{sans.length - 3}
                    </Badge>
                  )}
                </div>
              )
            },
          },
          {
            key: 'actions',
            header: '',
            render: (row) => {
              const cert = row as unknown as CertificateInfo
              return (
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={(e) => {
                      e.stopPropagation()
                      setConfirmRenew(cert)
                    }}
                    aria-label="Renew certificate"
                  >
                    <RefreshCw className="size-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={(e) => {
                      e.stopPropagation()
                      setConfirmRevoke(cert)
                    }}
                    aria-label="Revoke certificate"
                  >
                    <Ban className="size-3 text-destructive" />
                  </Button>
                </div>
              )
            },
          },
        ]}
        data={(certs ?? []) as unknown as Record<string, unknown>[]}
        searchable
        searchPlaceholder="Search certificates..."
        pageSize={20}
      />

      {/* Certificate detail sheet */}
      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent side="right" className="sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Certificate Detail</SheetTitle>
            {selectedCert && (
              <SheetDescription>{selectedCert.domain}</SheetDescription>
            )}
          </SheetHeader>
          {selectedCert && (
            <div className="space-y-4 overflow-auto px-4 pb-4">
              <div className="grid grid-cols-2 gap-y-2 text-sm">
                <span className="text-muted-foreground">Domain</span>
                <span className="font-mono">{selectedCert.domain}</span>

                <span className="text-muted-foreground">Issuer</span>
                <span>{selectedCert.issuer}</span>

                <span className="text-muted-foreground">Status</span>
                <StatusBadge status={certStatusToHealth(selectedCert.status)} />

                <span className="text-muted-foreground">Serial</span>
                <span className="font-mono text-xs">{selectedCert.serialNumber}</span>

                <span className="text-muted-foreground">Fingerprint</span>
                <span className="font-mono text-xs">{selectedCert.fingerprint}</span>

                <span className="text-muted-foreground">Issued</span>
                <TimeAgo date={selectedCert.issuedAt} />

                <span className="text-muted-foreground">Expires</span>
                <TimeAgo date={selectedCert.expiresAt} />

                <span className="text-muted-foreground">Auto-renew</span>
                <span>{selectedCert.autoRenew ? 'Yes' : 'No'}</span>
              </div>

              {selectedCert.sans.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium">Subject Alternative Names</h4>
                  <div className="flex flex-wrap gap-1">
                    {selectedCert.sans.map((san) => (
                      <Badge key={san} variant="secondary">{san}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {selectedCert.acmeProvider && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium">ACME</h4>
                  <span className="text-sm">{selectedCert.acmeProvider}</span>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Confirm dialogs */}
      {confirmRenew && (
        <ConfirmDialog
          open
          onOpenChange={(open) => { if (!open) setConfirmRenew(null) }}
          title="Renew Certificate"
          description={`Force renewal of the certificate for ${confirmRenew.domain}?`}
          confirmLabel="Renew"
          onConfirm={() => {
            renewMutation.mutate(confirmRenew.id)
            setConfirmRenew(null)
          }}
        />
      )}

      {confirmRevoke && (
        <ConfirmDialog
          open
          onOpenChange={(open) => { if (!open) setConfirmRevoke(null) }}
          title="Revoke Certificate"
          description={`Revoke the certificate for ${confirmRevoke.domain}? This cannot be undone.`}
          confirmLabel="Revoke"
          variant="destructive"
          onConfirm={() => {
            revokeMutation.mutate(confirmRevoke.id)
            setConfirmRevoke(null)
          }}
        />
      )}
    </div>
  )
}
