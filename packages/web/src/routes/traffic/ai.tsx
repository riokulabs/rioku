import { createFileRoute } from '@tanstack/react-router'
import { StatCard } from '../../components/StatCard'
import { DataTable } from '../../components/DataTable'

export const Route = createFileRoute('/traffic/ai')({
  component: TrafficAI,
})

const modelData = [
  {
    model: 'claude-sonnet-4-5',
    provider: 'Anthropic',
    requests: '12,847',
    tokens: '1.8M',
    cost: '$12.40',
  },
  {
    model: 'gpt-4o',
    provider: 'OpenAI',
    requests: '8,234',
    tokens: '420K',
    cost: '$4.82',
  },
  {
    model: 'llama3-70b',
    provider: 'Self-hosted',
    requests: '3,102',
    tokens: '180K',
    cost: '$1.20',
  },
]

function TrafficAI() {
  return (
    <>
      <div className="page-header">
        <h1>AI Workloads</h1>
        <p>LLM proxy usage and cost tracking</p>
      </div>

      <div className="card-grid-4 section">
        <StatCard
          icon={'\u2726'}
          iconColor="purple"
          value="2.4M"
          label="Total Tokens"
          trend="22%"
          trendDirection="up"
        />
        <StatCard
          icon={'\u0024'}
          iconColor="cyan"
          value="$18.42"
          label="Estimated Cost"
          trend="$2.10"
          trendDirection="up"
        />
        <StatCard
          icon={'\u25C9'}
          iconColor="green"
          value="7"
          label="Active Sessions"
        />
        <StatCard
          icon={'\u2B22'}
          iconColor="purple"
          value="3"
          label="Models Used"
        />
      </div>

      <DataTable
        title="Model Breakdown"
        columns={[
          { key: 'model', header: 'Model', render: (r) => <span className="font-mono">{r.model as string}</span> },
          { key: 'provider', header: 'Provider' },
          { key: 'requests', header: 'Requests', render: (r) => <span className="font-mono">{r.requests as string}</span> },
          { key: 'tokens', header: 'Tokens', render: (r) => <span className="font-mono">{r.tokens as string}</span> },
          { key: 'cost', header: 'Cost', render: (r) => <span className="font-mono">{r.cost as string}</span> },
        ]}
        data={modelData}
      />
    </>
  )
}
