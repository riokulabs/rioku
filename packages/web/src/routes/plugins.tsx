import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/plugins')({
  component: Plugins,
})

const plugins = [
  {
    name: 'rate-limit',
    type: 'Traffic',
    status: 'Active',
    version: 'v1.2.0',
    description: 'Token bucket rate limiting per route or global',
  },
  {
    name: 'auth-jwt',
    type: 'Middleware',
    status: 'Active',
    version: 'v1.0.3',
    description: 'JWT validation and claims extraction',
  },
  {
    name: 'llm-proxy',
    type: 'Traffic',
    status: 'Active',
    version: 'v0.9.1',
    description: 'Multi-provider LLM request routing and token tracking',
  },
  {
    name: 'agent-identity',
    type: 'Middleware',
    status: 'Disabled',
    version: 'v0.1.0',
    description: 'AI agent identity verification and attestation',
  },
]

function Plugins() {
  return (
    <>
      <div className="page-header">
        <h1>Plugins</h1>
        <p>Installed modules and extensions</p>
      </div>

      <div className="card-grid">
        {plugins.map((plugin) => (
          <div key={plugin.name} className="plugin-card">
            <div className="plugin-card-header">
              <span className="plugin-card-name">{plugin.name}</span>
              <span className={`badge ${plugin.status === 'Active' ? 'badge-green' : 'badge-muted'}`}>
                {plugin.status}
              </span>
            </div>
            <p className="text-muted text-sm">{plugin.description}</p>
            <div className="plugin-card-meta">
              <span className="badge badge-purple">{plugin.type}</span>
              <span className="badge badge-muted">{plugin.version}</span>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
