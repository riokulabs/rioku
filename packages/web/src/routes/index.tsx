import { createFileRoute } from '@tanstack/react-router'
import { StatCard } from '../components/StatCard'

export const Route = createFileRoute('/')({
  component: Dashboard,
})

function Dashboard() {
  return (
    <>
      <div className="page-header">
        <h1>Dashboard</h1>
        <p>Overview of your API gateway</p>
      </div>

      <div className="card-grid-4 section">
        <StatCard
          icon={'\u2B21'}
          iconColor="purple"
          value="1,247"
          label="Requests/s"
          trend="12%"
          trendDirection="up"
        />
        <StatCard
          icon={'\u25B3'}
          iconColor="green"
          value="0.02%"
          label="Error Rate"
          trend="0.01%"
          trendDirection="down"
        />
        <StatCard
          icon={'\u2B22'}
          iconColor="cyan"
          value="3/3"
          label="Active Nodes"
        />
        <StatCard
          icon={'\u2726'}
          iconColor="purple"
          value="45.2K"
          label="AI Tokens/min"
          trend="8%"
          trendDirection="up"
        />
      </div>

      <div className="card-grid-2 section">
        <div className="chart-placeholder">
          <div className="chart-placeholder-title">Traffic Overview (24h)</div>
          <div className="chart-placeholder-body">
            Chart will render here
          </div>
        </div>
        <div className="chart-placeholder">
          <div className="chart-placeholder-title">Response Latency (24h)</div>
          <div className="chart-placeholder-body">
            Chart will render here
          </div>
        </div>
      </div>
    </>
  )
}
