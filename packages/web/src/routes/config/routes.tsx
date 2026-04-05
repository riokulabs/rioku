import { createFileRoute } from '@tanstack/react-router'
import { DataTable } from '../../components/DataTable'

export const Route = createFileRoute('/config/routes')({
  component: ConfigRoutes,
})

const sampleRoutes = [
  {
    name: 'api-gateway',
    match: 'api.example.com /v1/*',
    service: 'backend-api',
    status: 'active',
    updated: '2 hours ago',
  },
  {
    name: 'web-app',
    match: 'app.example.com /*',
    service: 'frontend',
    status: 'active',
    updated: '1 day ago',
  },
  {
    name: 'legacy-redirect',
    match: 'old.example.com /*',
    service: 'redirect-svc',
    status: 'disabled',
    updated: '5 days ago',
  },
]

function ConfigRoutes() {
  return (
    <>
      <div className="page-header">
        <h1>Routes</h1>
        <p>Manage request routing rules</p>
      </div>

      <DataTable
        title="Routes"
        columns={[
          { key: 'name', header: 'Name', render: (r) => <span className="font-mono">{r.name as string}</span> },
          { key: 'match', header: 'Match', render: (r) => <span className="font-mono text-muted">{r.match as string}</span> },
          { key: 'service', header: 'Service', render: (r) => <span className="font-mono">{r.service as string}</span> },
          {
            key: 'status',
            header: 'Status',
            render: (r) => (
              <span className={`badge ${(r.status as string) === 'active' ? 'badge-green' : 'badge-muted'}`}>
                {r.status as string}
              </span>
            ),
          },
          { key: 'updated', header: 'Updated' },
        ]}
        data={sampleRoutes}
        actions={<button className="btn btn-primary">+ Add Route</button>}
      />
    </>
  )
}
