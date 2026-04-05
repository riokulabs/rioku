import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/cluster')({
  component: Cluster,
})

const nodes = [
  {
    name: 'node-1',
    role: 'Bootstrap',
    health: 'Healthy',
    daemonVersion: 'v0.1.0-dev',
    caddyVersion: 'v2.9.1',
    storeMode: 'SQLite (local)',
    lastSeen: '< 1s ago',
  },
  {
    name: 'node-2',
    role: 'Member',
    health: 'Healthy',
    daemonVersion: 'v0.1.0-dev',
    caddyVersion: 'v2.9.1',
    storeMode: 'SQLite (replica)',
    lastSeen: '2s ago',
  },
  {
    name: 'node-3',
    role: 'Member',
    health: 'Healthy',
    daemonVersion: 'v0.1.0-dev',
    caddyVersion: 'v2.9.1',
    storeMode: 'SQLite (replica)',
    lastSeen: '1s ago',
  },
]

function Cluster() {
  return (
    <>
      <div className="page-header">
        <h1>Cluster</h1>
        <p>Node membership and health</p>
      </div>

      <div className="card-grid">
        {nodes.map((node) => (
          <div key={node.name} className="node-card">
            <div className="node-card-header">
              <span className={`status-dot ${node.health === 'Healthy' ? 'green' : 'red'}`} />
              <span className="node-card-name">{node.name}</span>
              <span className={`badge ${node.role === 'Bootstrap' ? 'badge-purple' : 'badge-cyan'}`}>
                {node.role}
              </span>
            </div>
            <div className="node-card-details">
              <div className="node-card-row">
                <span className="node-card-row-label">Health</span>
                <span className="node-card-row-value" style={{ color: 'var(--green)' }}>{node.health}</span>
              </div>
              <div className="node-card-row">
                <span className="node-card-row-label">Daemon</span>
                <span className="node-card-row-value">{node.daemonVersion}</span>
              </div>
              <div className="node-card-row">
                <span className="node-card-row-label">Caddy</span>
                <span className="node-card-row-value">{node.caddyVersion}</span>
              </div>
              <div className="node-card-row">
                <span className="node-card-row-label">Store</span>
                <span className="node-card-row-value">{node.storeMode}</span>
              </div>
              <div className="node-card-row">
                <span className="node-card-row-label">Last Seen</span>
                <span className="node-card-row-value">{node.lastSeen}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
