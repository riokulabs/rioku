import { createFileRoute } from '@tanstack/react-router'
import { StatCard } from '../../components/StatCard'

export const Route = createFileRoute('/traffic/analytics')({
  component: TrafficAnalytics,
})

function TrafficAnalytics() {
  return (
    <>
      <div className="page-header">
        <h1>Analytics</h1>
        <p>Traffic patterns and performance metrics</p>
      </div>

      <div className="card-grid-2 section">
        <div className="chart-placeholder">
          <div className="chart-placeholder-title">Request Rate</div>
          <div className="chart-placeholder-body">
            Chart will render here
          </div>
        </div>
        <div className="chart-placeholder">
          <div className="chart-placeholder-title">Error Rate</div>
          <div className="chart-placeholder-body">
            Chart will render here
          </div>
        </div>
      </div>

      <div className="card-grid-4 section">
        <StatCard
          icon={'\u2211'}
          iconColor="purple"
          value="1.2M"
          label="Total Requests"
          trend="18%"
          trendDirection="up"
        />
        <StatCard
          icon={'\u29D7'}
          iconColor="cyan"
          value="12ms"
          label="Avg Latency"
          trend="3ms"
          trendDirection="down"
        />
        <StatCard
          icon={'\u29D7'}
          iconColor="purple"
          value="142ms"
          label="P99 Latency"
          trend="8ms"
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
      </div>
    </>
  )
}
