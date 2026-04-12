import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders as render } from '@/test/utils'
import { TrafficTab } from '@/components/rioku/traffic-tab'

// Mock recharts to avoid rendering SVG in happy-dom
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="responsive-container">{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => <div data-testid="bar" />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  Tooltip: () => <div />,
  CartesianGrid: () => <div />,
  Legend: () => <div />,
}))

describe('TrafficTab', () => {
  const mockData = {
    rps: 342,
    rpsDelta: '+5.2%',
    errorRate: 0.12,
    errorCount: 3,
    totalRequests: 2508,
    p95LatencyMs: 45,
    p50LatencyMs: 18,
    requestRateData: [],
    errorBreakdownData: [],
    recentRequests: [],
  }

  it('renders stat cards with traffic data', () => {
    render(<TrafficTab data={mockData} />)
    expect(screen.getByText('342')).toBeInTheDocument()
    expect(screen.getByText('0.12%')).toBeInTheDocument()
    expect(screen.getByText('45ms')).toBeInTheDocument()
  })

  it('renders loading state when data is null', () => {
    render(<TrafficTab data={null} isLoading />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('renders RPS delta when provided', () => {
    render(<TrafficTab data={mockData} />)
    expect(screen.getByText('+5.2% vs last hour')).toBeInTheDocument()
  })

  it('renders P50 latency when provided', () => {
    render(<TrafficTab data={mockData} />)
    expect(screen.getByText('P50: 18ms')).toBeInTheDocument()
  })

  it('renders error count and total requests', () => {
    render(<TrafficTab data={mockData} />)
    expect(screen.getByText(/3 errors/)).toBeInTheDocument()
    expect(screen.getByText(/2,508 total/)).toBeInTheDocument()
  })

  it('shows green color for low error rate', () => {
    render(<TrafficTab data={mockData} />)
    const errorRateEl = screen.getByText('0.12%')
    expect(errorRateEl).toHaveClass('text-green-500')
  })

  it('shows red color for high error rate', () => {
    render(<TrafficTab data={{ ...mockData, errorRate: 5.5 }} />)
    const errorRateEl = screen.getByText('5.5%')
    expect(errorRateEl).toHaveClass('text-red-500')
  })

  it('renders loading skeleton when isLoading is true with null data', () => {
    const { container } = render(<TrafficTab data={null} isLoading />)
    const skeletons = container.querySelectorAll('[data-slot="skeleton"]')
    expect(skeletons.length).toBeGreaterThan(0)
  })

  it('renders request rate chart when data is provided', () => {
    const data = {
      ...mockData,
      requestRateData: [
        { time: '10:00', rps: 100 },
        { time: '10:05', rps: 120 },
      ],
    }
    render(<TrafficTab data={data} />)
    expect(screen.getByText('Request Rate (last 1h)')).toBeInTheDocument()
  })

  it('renders error breakdown chart when data is provided', () => {
    const data = {
      ...mockData,
      errorBreakdownData: [
        { time: '10:00', '4xx': 2, '5xx': 1 },
      ],
    }
    render(<TrafficTab data={data} />)
    expect(screen.getByText('Error Breakdown')).toBeInTheDocument()
  })

  it('renders recent requests table when data is provided', () => {
    const data = {
      ...mockData,
      recentRequests: [
        { time: '10:01', method: 'GET', path: '/api/users', status: 200, latencyMs: 12 },
        { time: '10:02', method: 'POST', path: '/api/orders', status: 500, latencyMs: 89 },
      ],
    }
    render(<TrafficTab data={data} />)
    expect(screen.getByText('Recent Requests')).toBeInTheDocument()
    expect(screen.getByText('GET')).toBeInTheDocument()
    expect(screen.getByText('/api/users')).toBeInTheDocument()
    expect(screen.getByText('200')).toBeInTheDocument()
    expect(screen.getByText('12ms')).toBeInTheDocument()
  })

  it('does not render charts or table when arrays are empty', () => {
    render(<TrafficTab data={mockData} />)
    expect(screen.queryByText('Request Rate (last 1h)')).not.toBeInTheDocument()
    expect(screen.queryByText('Error Breakdown')).not.toBeInTheDocument()
    expect(screen.queryByText('Recent Requests')).not.toBeInTheDocument()
  })

  it('renders bandwidth stat when provided', () => {
    render(<TrafficTab data={{ ...mockData, bandwidth: '1.2 GB/s' }} />)
    expect(screen.getByText('1.2 GB/s')).toBeInTheDocument()
    expect(screen.getByText('Bandwidth')).toBeInTheDocument()
  })

  it('renders active connections when bandwidth is not provided', () => {
    render(<TrafficTab data={{ ...mockData, activeConnections: 42 }} />)
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('Active Connections')).toBeInTheDocument()
  })
})
