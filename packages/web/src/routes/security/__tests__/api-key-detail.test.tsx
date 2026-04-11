import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockKey = { id: 'k1', name: 'ci-key', prefix: 'rku_abc', scopes: ['routes:read', 'config:read'], expiresAt: '2027-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z' }
const mockUsage = { requests24h: 1234, requests7d: 5678, requests30d: 12345, lastUsed: '2026-04-11T10:00:00Z' }
const mockActivity = { entries: [
  { action: 'Key created', user: 'admin', timestamp: '2026-01-01T00:00:00Z', detail: 'Key created' },
  { action: 'Scopes updated', user: 'admin', timestamp: '2026-02-01T00:00:00Z', detail: 'Added scope' },
] }

vi.mock('@tanstack/react-router', () => ({ createFileRoute: () => () => ({ useLoaderData: () => ({ key: mockKey }) }), Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to} data-testid="router-link">{children}</a>, useNavigate: () => vi.fn() }))
vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === 'api-key-usage') return { data: mockUsage, isLoading: false }
    if (queryKey[0] === 'api-key-activity') return { data: mockActivity, isLoading: false }
    return { data: null, isLoading: false }
  },
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => { const t: Record<string, string> = { 'detail.backToList': 'Back to API keys', 'detail.details': 'Details', 'detail.usage': 'Usage', 'detail.activity': 'Activity', 'detail.scopes': 'Scopes', 'detail.dangerZone': 'Danger zone', 'detail.revokeKey': 'Revoke key', 'messages.keyRevoked': 'Key revoked' }; return t[k] ?? k } }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/api', () => ({ apiClient: { get: vi.fn(), del: vi.fn() } }))
vi.mock('lucide-react', () => ({ ArrowLeftIcon: () => <span />, TrashIcon: () => <span />, ActivityIcon: () => <span />, BarChart3Icon: () => <span data-testid="chart-icon" />, ClockIcon: () => <span data-testid="clock-icon" /> }))
vi.mock('@/components/rioku/confirm-dialog', () => ({ ConfirmDialog: ({ open }: { open: boolean }) => open ? <div data-testid="confirm-dialog" /> : null }))
vi.mock('@/components/rioku/time-ago', () => ({ TimeAgo: ({ date }: { date: string }) => <span data-testid="time-ago">{date}</span> }))
vi.mock('@/components/rioku/stat-card', () => ({ StatCard: ({ title, value }: { title: string; value: string }) => <div data-testid="stat-card"><span>{title}</span><span>{value}</span></div> }))
vi.mock('@/components/rioku/activity-timeline', () => ({ ActivityTimeline: ({ entries, title }: { entries: unknown[]; title: string }) => <div data-testid="activity-timeline"><span>{title}</span><span>{entries.length} entries</span></div> }))
vi.mock('@/components/ui/button', () => ({ Button: ({ children, onClick, ...props }: React.ComponentProps<'button'>) => <button onClick={onClick} {...props}>{children}</button> }))
vi.mock('@/components/ui/badge', () => ({ Badge: ({ children }: { children: React.ReactNode }) => <span data-testid="badge">{children}</span> }))
vi.mock('@/components/ui/input', () => ({ Input: (props: React.ComponentProps<'input'>) => <input {...props} /> }))
vi.mock('@/components/ui/label', () => ({ Label: ({ children, ...props }: React.ComponentProps<'label'>) => <label {...props}>{children}</label> }))
vi.mock('@/components/ui/tabs', () => ({ Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, TabsTrigger: ({ children, value }: { children: React.ReactNode; value: string }) => <button data-testid={`tab-${value}`}>{children}</button>, TabsContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/components/ui/card', () => ({ Card: ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className}>{children}</div>, CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, CardTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3> }))

import { ApiKeyDetailPage } from '../api-keys.$keyId'

describe('ApiKeyDetailPage', () => {
  it('renders key name', () => { render(<ApiKeyDetailPage />); expect(screen.getByText('ci-key')).toBeInTheDocument() })
  it('renders back link', () => { render(<ApiKeyDetailPage />); expect(screen.getByText('Back to API keys')).toBeInTheDocument() })
  it('renders tabs', () => { render(<ApiKeyDetailPage />); expect(screen.getByTestId('tab-details')).toBeInTheDocument(); expect(screen.getByTestId('tab-usage')).toBeInTheDocument(); expect(screen.getByTestId('tab-activity')).toBeInTheDocument() })
  it('renders key prefix', () => { render(<ApiKeyDetailPage />); expect(screen.getByText('rku_abc...')).toBeInTheDocument() })
  it('renders scopes as badges', () => { render(<ApiKeyDetailPage />); expect(screen.getByText('routes:read')).toBeInTheDocument(); expect(screen.getByText('config:read')).toBeInTheDocument() })
  it('renders revoke button in danger zone', () => { render(<ApiKeyDetailPage />); expect(screen.getByText('Revoke key')).toBeInTheDocument() })
  it('shows confirm dialog when revoke clicked', async () => { const user = userEvent.setup(); render(<ApiKeyDetailPage />); await user.click(screen.getByText('Revoke key')); expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument() })

  // Usage tab tests
  it('renders usage stat cards', () => { render(<ApiKeyDetailPage />); const cards = screen.getAllByTestId('stat-card'); expect(cards.length).toBe(3) })
  it('renders request counts in stat cards', () => { render(<ApiKeyDetailPage />); expect(screen.getByText('1,234')).toBeInTheDocument(); expect(screen.getByText('5,678')).toBeInTheDocument(); expect(screen.getByText('12,345')).toBeInTheDocument() })
  it('renders last used timestamp', () => { render(<ApiKeyDetailPage />); expect(screen.getByText('Last used:')).toBeInTheDocument() })

  // Activity tab tests
  it('renders activity timeline', () => { render(<ApiKeyDetailPage />); expect(screen.getByTestId('activity-timeline')).toBeInTheDocument() })
  it('renders activity entries count', () => { render(<ApiKeyDetailPage />); expect(screen.getByText('2 entries')).toBeInTheDocument() })
})
