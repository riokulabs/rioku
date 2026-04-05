import { createFileRoute } from '@tanstack/react-router'
import { DataTable } from '../../components/DataTable'

export const Route = createFileRoute('/config/policies')({
  component: ConfigPolicies,
})

const samplePolicies = [
  {
    name: 'rate-limit-global',
    type: 'rate-limit',
    attachedTo: 'api-gateway',
    updated: '1 hour ago',
  },
  {
    name: 'jwt-auth',
    type: 'authentication',
    attachedTo: 'api-gateway, web-app',
    updated: '3 days ago',
  },
  {
    name: 'cors-allow-all',
    type: 'cors',
    attachedTo: 'web-app',
    updated: '1 week ago',
  },
]

function ConfigPolicies() {
  return (
    <>
      <div className="page-header">
        <h1>Policies</h1>
        <p>Traffic policies and middleware configuration</p>
      </div>

      <DataTable
        title="Policies"
        columns={[
          { key: 'name', header: 'Name', render: (r) => <span className="font-mono">{r.name as string}</span> },
          {
            key: 'type',
            header: 'Type',
            render: (r) => <span className="badge badge-cyan">{r.type as string}</span>,
          },
          { key: 'attachedTo', header: 'Attached To', render: (r) => <span className="font-mono text-muted">{r.attachedTo as string}</span> },
          { key: 'updated', header: 'Updated' },
        ]}
        data={samplePolicies}
        actions={<button className="btn btn-primary">+ Add Policy</button>}
      />
    </>
  )
}
