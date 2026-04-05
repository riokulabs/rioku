import { createFileRoute } from '@tanstack/react-router'
import { DataTable } from '../components/DataTable'

export const Route = createFileRoute('/security')({
  component: Security,
})

const apiKeys = [
  {
    name: 'CI Pipeline',
    keyPrefix: 'rku_ci_****',
    scope: 'config:write',
    expires: '2027-01-15',
    created: '2026-01-15',
  },
  {
    name: 'Monitoring',
    keyPrefix: 'rku_mon_****',
    scope: 'traffic:read',
    expires: 'Never',
    created: '2026-02-20',
  },
  {
    name: 'Dev Local',
    keyPrefix: 'rku_dev_****',
    scope: 'admin',
    expires: '2026-06-01',
    created: '2026-03-01',
  },
]

const certStatuses = [
  { label: 'CA Status', status: 'Healthy', detail: 'Root CA operational', color: 'green' as const },
  { label: 'Node Cert', status: 'Valid', detail: 'Expires in 340 days', color: 'green' as const },
  { label: 'DB Cert', status: 'Valid', detail: 'Expires in 340 days', color: 'green' as const },
]

function Security() {
  return (
    <>
      <div className="page-header">
        <h1>Security</h1>
        <p>API keys, certificates, and access control</p>
      </div>

      <div className="section">
        <DataTable
          title="API Keys"
          columns={[
            { key: 'name', header: 'Name' },
            { key: 'keyPrefix', header: 'Key Prefix', render: (r) => <span className="font-mono">{r.keyPrefix as string}</span> },
            { key: 'scope', header: 'Scope', render: (r) => <span className="badge badge-purple">{r.scope as string}</span> },
            { key: 'expires', header: 'Expires' },
            { key: 'created', header: 'Created' },
          ]}
          data={apiKeys}
          actions={<button className="btn btn-primary">+ Create Key</button>}
        />
      </div>

      <div className="section">
        <div className="card">
          <div className="card-header">
            <h3>Certificate Status</h3>
          </div>
          <div className="card-grid" style={{ padding: 0 }}>
            {certStatuses.map((cert) => (
              <div key={cert.label} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0' }}>
                <span className={`status-dot ${cert.color}`} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{cert.label}</div>
                  <div className="text-muted text-sm">
                    {cert.status} — {cert.detail}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
