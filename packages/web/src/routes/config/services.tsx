import { createFileRoute } from '@tanstack/react-router'
import { DataTable } from '../../components/DataTable'

export const Route = createFileRoute('/config/services')({
  component: ConfigServices,
})

const sampleServices = [
  {
    name: 'backend-api',
    upstreams: '10.0.1.10:8080, 10.0.1.11:8080',
    lbPolicy: 'round-robin',
    health: 'healthy',
    updated: '3 hours ago',
  },
  {
    name: 'frontend',
    upstreams: '10.0.2.10:3000',
    lbPolicy: 'random',
    health: 'healthy',
    updated: '1 day ago',
  },
  {
    name: 'redirect-svc',
    upstreams: '10.0.3.10:8080',
    lbPolicy: 'first',
    health: 'degraded',
    updated: '2 days ago',
  },
]

function ConfigServices() {
  return (
    <>
      <div className="page-header">
        <h1>Services</h1>
        <p>Upstream service definitions and load balancing</p>
      </div>

      <DataTable
        title="Services"
        columns={[
          { key: 'name', header: 'Name', render: (r) => <span className="font-mono">{r.name as string}</span> },
          { key: 'upstreams', header: 'Upstreams', render: (r) => <span className="font-mono text-muted text-xs">{r.upstreams as string}</span> },
          { key: 'lbPolicy', header: 'LB Policy', render: (r) => <span className="badge badge-purple">{r.lbPolicy as string}</span> },
          {
            key: 'health',
            header: 'Health',
            render: (r) => {
              const h = r.health as string
              return (
                <span className="flex items-center gap-2">
                  <span className={`status-dot ${h === 'healthy' ? 'green' : 'yellow'}`} />
                  {h}
                </span>
              )
            },
          },
          { key: 'updated', header: 'Updated' },
        ]}
        data={sampleServices}
        actions={<button className="btn btn-primary">+ Add Service</button>}
      />
    </>
  )
}
