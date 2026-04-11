export interface UserSession {
  id: string
  device: string
  ip: string
  location: string
  lastActive: string
  current: boolean
  userAgent: string
  createdAt: string
}

export const mockUserSessions: Record<string, UserSession[]> = {
  'user-admin': [
    { id: 'sess-admin-1', device: 'Chrome on macOS', ip: '192.168.1.42', location: 'San Francisco, CA', lastActive: new Date().toISOString(), current: true, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', createdAt: '2026-04-11T08:30:00Z' },
    { id: 'sess-admin-2', device: 'Firefox on Ubuntu', ip: '10.0.0.15', location: 'San Francisco, CA', lastActive: '2026-04-11T06:00:00Z', current: false, userAgent: 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64)', createdAt: '2026-04-10T14:00:00Z' },
    { id: 'sess-admin-3', device: 'Rioku CLI', ip: '172.16.0.8', location: 'AWS us-east-1', lastActive: '2026-04-11T02:00:00Z', current: false, userAgent: 'rioku-cli/0.1.0', createdAt: '2026-04-09T20:00:00Z' },
  ],
  'user-alice': [
    { id: 'sess-alice-1', device: 'Chrome on Windows', ip: '192.168.1.55', location: 'Austin, TX', lastActive: new Date().toISOString(), current: true, userAgent: 'Mozilla/5.0 (Windows NT 10.0)', createdAt: '2026-04-11T09:00:00Z' },
    { id: 'sess-alice-2', device: 'Safari on iPhone', ip: '73.45.12.89', location: 'Austin, TX', lastActive: '2026-04-10T22:00:00Z', current: false, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0)', createdAt: '2026-04-10T18:00:00Z' },
  ],
  'user-bob': [
    { id: 'sess-bob-1', device: 'Chrome on Linux', ip: '10.0.1.25', location: 'Portland, OR', lastActive: new Date().toISOString(), current: true, userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', createdAt: '2026-04-11T07:30:00Z' },
  ],
  'user-carol': [],
  'user-dave': [],
}
