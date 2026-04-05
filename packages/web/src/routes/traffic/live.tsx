import { createFileRoute } from '@tanstack/react-router'
import { DataTable } from '../../components/DataTable'

export const Route = createFileRoute('/traffic/live')({
  component: TrafficLive,
})

const sampleRequests = [
  { time: '14:32:01.234', method: 'GET', path: '/v1/users', status: 200, latency: '12ms', upstream: '10.0.1.10:8080' },
  { time: '14:32:01.189', method: 'POST', path: '/v1/auth/login', status: 200, latency: '45ms', upstream: '10.0.1.11:8080' },
  { time: '14:32:01.102', method: 'GET', path: '/v1/products?page=2', status: 200, latency: '8ms', upstream: '10.0.1.10:8080' },
  { time: '14:32:00.987', method: 'DELETE', path: '/v1/sessions/abc123', status: 204, latency: '15ms', upstream: '10.0.1.11:8080' },
  { time: '14:32:00.891', method: 'GET', path: '/v1/health', status: 200, latency: '1ms', upstream: '10.0.1.10:8080' },
  { time: '14:32:00.756', method: 'POST', path: '/v1/webhooks', status: 422, latency: '23ms', upstream: '10.0.1.11:8080' },
  { time: '14:32:00.612', method: 'GET', path: '/v1/users/42/profile', status: 404, latency: '6ms', upstream: '10.0.1.10:8080' },
  { time: '14:32:00.501', method: 'PUT', path: '/v1/settings', status: 500, latency: '142ms', upstream: '10.0.1.11:8080' },
]

function statusBadgeClass(status: number): string {
  if (status < 300) return 'badge-green'
  if (status < 400) return 'badge-cyan'
  if (status < 500) return 'badge-yellow'
  return 'badge-red'
}

function TrafficLive() {
  return (
    <>
      <div className="page-header">
        <h1>Live Traffic</h1>
        <p>Real-time request stream</p>
      </div>

      <div className="filter-bar">
        <select className="form-select" defaultValue="">
          <option value="">All Routes</option>
          <option value="api-gateway">api-gateway</option>
          <option value="web-app">web-app</option>
        </select>
        <select className="form-select" defaultValue="">
          <option value="">All Status</option>
          <option value="2xx">2xx</option>
          <option value="4xx">4xx</option>
          <option value="5xx">5xx</option>
        </select>
        <input
          type="text"
          className="form-input"
          placeholder="Search path, method, upstream..."
          readOnly
        />
      </div>

      <DataTable
        columns={[
          { key: 'time', header: 'Time', render: (r) => <span className="font-mono text-xs">{r.time as string}</span> },
          {
            key: 'method',
            header: 'Method',
            render: (r) => <span className="font-mono" style={{ fontWeight: 600 }}>{r.method as string}</span>,
          },
          { key: 'path', header: 'Path', render: (r) => <span className="font-mono text-muted">{r.path as string}</span> },
          {
            key: 'status',
            header: 'Status',
            render: (r) => (
              <span className={`badge ${statusBadgeClass(r.status as number)}`}>
                {r.status as number}
              </span>
            ),
          },
          { key: 'latency', header: 'Latency', render: (r) => <span className="font-mono">{r.latency as string}</span> },
          { key: 'upstream', header: 'Upstream', render: (r) => <span className="font-mono text-muted text-xs">{r.upstream as string}</span> },
        ]}
        data={sampleRequests}
      />
    </>
  )
}
