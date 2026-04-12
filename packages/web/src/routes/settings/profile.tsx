import { useState, type FormEvent } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { QRCodeSVG } from 'qrcode.react'
import { PageHeader } from '@/components/rioku/page-header'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { SearchableSelect } from '@rioku/ui'
import type { SelectOption } from '@rioku/ui'
import { useTheme } from '@/hooks/use-theme'
import { usePreferences } from '@/hooks/use-preferences'
import { cn } from '@/lib/utils'
import { apiClient } from '@/lib/api'

const TIMEZONE_OPTIONS: SelectOption[] = [
  { value: 'UTC', label: 'UTC', description: 'Coordinated Universal Time' },
  { value: 'America/New_York', label: 'America/New_York', description: 'Eastern Time' },
  { value: 'America/Chicago', label: 'America/Chicago', description: 'Central Time' },
  { value: 'America/Denver', label: 'America/Denver', description: 'Mountain Time' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles', description: 'Pacific Time' },
  { value: 'America/Anchorage', label: 'America/Anchorage', description: 'Alaska Time' },
  { value: 'Pacific/Honolulu', label: 'Pacific/Honolulu', description: 'Hawaii Time' },
  { value: 'Europe/London', label: 'Europe/London', description: 'GMT' },
  { value: 'Europe/Paris', label: 'Europe/Paris', description: 'CET' },
  { value: 'Europe/Madrid', label: 'Europe/Madrid', description: 'CET' },
  { value: 'Europe/Berlin', label: 'Europe/Berlin', description: 'CET' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo', description: 'JST' },
  { value: 'Asia/Seoul', label: 'Asia/Seoul', description: 'KST' },
  { value: 'Asia/Shanghai', label: 'Asia/Shanghai', description: 'CST' },
  { value: 'Asia/Kolkata', label: 'Asia/Kolkata', description: 'IST' },
  { value: 'Asia/Dubai', label: 'Asia/Dubai', description: 'GST' },
  { value: 'Australia/Sydney', label: 'Australia/Sydney', description: 'AET' },
  { value: 'Pacific/Auckland', label: 'Pacific/Auckland', description: 'NZT' },
]

const LOCALE_OPTIONS: SelectOption[] = [
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'es-ES', label: 'Espanol' },
  { value: 'fr-FR', label: 'Francais' },
  { value: 'de-DE', label: 'Deutsch' },
  { value: 'ja-JP', label: 'Japanese' },
  { value: 'ko-KR', label: 'Korean' },
  { value: 'zh-CN', label: 'Chinese (Simplified)' },
  { value: 'pt-BR', label: 'Portugues (BR)' },
]

const COLORBLIND_OPTIONS = [
  { value: 'none', label: 'None', description: 'Standard color vision' },
  { value: 'deuteranopia', label: 'Deuteranopia', description: 'Red-green (most common)' },
  { value: 'protanopia', label: 'Protanopia', description: 'Red-green (reduced red)' },
  { value: 'tritanopia', label: 'Tritanopia', description: 'Blue-yellow (rare)' },
  { value: 'achromatopsia', label: 'Achromatopsia', description: 'Total color blindness' },
]

export const Route = createFileRoute('/settings/profile')({
  component: ProfilePage,
})

function ProfilePage() {
  const { session } = Route.useRouteContext() as { session: import('@/lib/api').MeResponse }
  const user = session.user
  const queryClient = useQueryClient()

  // --- Preferences ---
  const { theme, setTheme } = useTheme()
  const [colorBlindMode, setColorBlindMode] = usePreferences('colorBlindMode', 'none', 'global')
  const [highContrast, setHighContrast] = usePreferences('highContrast', false, 'global')
  const [reducedMotion, setReducedMotion] = usePreferences('reducedMotion', false, 'global')
  const [timezone, setTimezone] = usePreferences('timezone', 'UTC', 'global')
  const [locale, setLocale] = usePreferences('locale', 'en-US', 'global')

  // --- Sessions ---
  interface SessionEntry {
    device: string
    ip: string
    lastActive: string
    location: string
    current?: boolean
  }
  const { data: sessionsData } = useQuery({
    queryKey: ['auth', 'sessions'],
    queryFn: () => apiClient.get<{ sessions: SessionEntry[] }>('/auth/sessions'),
    retry: false,
  })
  const sessions: SessionEntry[] = sessionsData?.sessions ?? [
    { device: 'Chrome on macOS', ip: '192.168.1.42', lastActive: 'Now', location: 'San Francisco, CA', current: true },
    { device: 'Firefox on Ubuntu', ip: '10.0.0.15', lastActive: '2 hours ago', location: 'San Francisco, CA', current: false },
    { device: 'Rioku CLI', ip: '172.16.0.8', lastActive: '6 hours ago', location: 'AWS us-east-1', current: false },
  ]

  // --- Profile form ---
  const [displayName, setDisplayName] = useState(user.displayName ?? '')
  const [email, setEmail] = useState(user.email ?? '')

  const profileMutation = useMutation({
    mutationFn: () =>
      apiClient.patch('/auth/me', { displayName, email }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
      toast.success('Profile updated')
    },
    onError: () => toast.error('Failed to update profile'),
  })

  // --- Password change form ---
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwError, setPwError] = useState<string | null>(null)

  const passwordMutation = useMutation({
    mutationFn: () =>
      apiClient.post('/auth/password', {
        currentPassword: currentPw,
        newPassword: newPw,
      }),
    onSuccess: () => {
      toast.success('Password changed')
      setCurrentPw('')
      setNewPw('')
      setConfirmPw('')
    },
    onError: (err: { detail?: string }) =>
      toast.error(err.detail ?? 'Failed to change password'),
  })

  const handlePasswordSubmit = (e: FormEvent) => {
    e.preventDefault()
    setPwError(null)
    if (newPw !== confirmPw) {
      setPwError('Passwords do not match.')
      return
    }
    passwordMutation.mutate()
  }

  // --- TOTP ---
  const [totpSetup, setTotpSetup] = useState<{
    secret: string
    qrUri: string
  } | null>(null)
  const [totpVerifyCode, setTotpVerifyCode] = useState('')

  const totpSetupMutation = useMutation({
    mutationFn: () =>
      apiClient.post<{ secret: string; qrUri: string }>('/auth/totp/setup'),
    onSuccess: (data) => setTotpSetup(data),
    onError: () => toast.error('Failed to start TOTP setup'),
  })

  const totpVerifyMutation = useMutation({
    mutationFn: () =>
      apiClient.post('/auth/totp/verify', { code: totpVerifyCode }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
      toast.success('Two-factor authentication enabled')
      setTotpSetup(null)
      setTotpVerifyCode('')
    },
    onError: () => toast.error('Invalid code — try again'),
  })

  const totpDisableMutation = useMutation({
    mutationFn: () => apiClient.post('/auth/totp/disable'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
      toast.success('Two-factor authentication disabled')
    },
    onError: () => toast.error('Failed to disable TOTP'),
  })

  return (
    <div className="space-y-6">
      <PageHeader title="My Profile" description="Manage your account settings, security, and preferences" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ---- Left Column: Profile Information ---- */}
        <Card>
          <CardHeader>
            <CardTitle>Profile Information</CardTitle>
            <CardDescription>
              Update your display name and email address.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                profileMutation.mutate()
              }}
              className="space-y-5"
            >
              {/* Avatar + summary */}
              <div className="flex items-center gap-4">
                <div className="flex size-16 items-center justify-center rounded-full bg-primary/15 text-primary text-xl font-bold">
                  {(displayName || user.username || '?').charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-medium">{displayName || user.username}</p>
                  <p className="text-xs text-muted-foreground">@{user.username} · {email}</p>
                  <div className="mt-1 flex items-center gap-2">
                    {user.roles?.map((role: string) => (
                      <Badge key={role} variant="secondary">{role}</Badge>
                    )) ?? <Badge variant="secondary">User</Badge>}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Username</Label>
                  <Input value={user.username} readOnly className="font-mono" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="display-name">Display name</Label>
                  <Input
                    id="display-name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>

              <Button type="submit" disabled={profileMutation.isPending}>
                {profileMutation.isPending ? 'Saving...' : 'Save changes'}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* ---- Right Column ---- */}
        <div className="space-y-6">
          {/* Change Password */}
          <Card>
            <CardHeader>
              <CardTitle>Change password</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handlePasswordSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="pw-current">Current password</Label>
                  <Input
                    id="pw-current"
                    type="password"
                    value={currentPw}
                    onChange={(e) => setCurrentPw(e.target.value)}
                    autoComplete="current-password"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pw-new">New password</Label>
                  <Input
                    id="pw-new"
                    type="password"
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                    autoComplete="new-password"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pw-confirm">Confirm new password</Label>
                  <Input
                    id="pw-confirm"
                    type="password"
                    value={confirmPw}
                    onChange={(e) => setConfirmPw(e.target.value)}
                    autoComplete="new-password"
                  />
                </div>
                {pwError && <p className="text-sm text-destructive">{pwError}</p>}
                <Button type="submit" disabled={passwordMutation.isPending}>
                  {passwordMutation.isPending ? 'Saving...' : 'Change password'}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Preferences (theme, timezone, locale) */}
          <Card>
            <CardHeader>
              <CardTitle>Preferences</CardTitle>
              <CardDescription>Theme, timezone, and language</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Theme</Label>
                <div className="flex gap-2">
                  {(['dark', 'light', 'system'] as const).map((t) => (
                    <Button
                      key={t}
                      variant={theme === t ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setTheme(t)}
                      className="capitalize"
                    >
                      {t}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Timezone</Label>
                <SearchableSelect
                  options={TIMEZONE_OPTIONS}
                  value={timezone}
                  onChange={setTimezone}
                  placeholder="Select timezone..."
                />
              </div>
              <div className="space-y-2">
                <Label>Locale</Label>
                <SearchableSelect
                  options={LOCALE_OPTIONS}
                  value={locale}
                  onChange={setLocale}
                  placeholder="Select locale..."
                />
              </div>
            </CardContent>
          </Card>

          {/* TOTP */}
          <Card>
            <CardHeader>
              <CardTitle>Two-factor authentication</CardTitle>
              <CardDescription>
                Use an authenticator app (e.g. Google Authenticator, Authy) for a
                second layer of protection.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {user.totpEnabled ? (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">Enabled</Badge>
                    <span className="text-sm text-muted-foreground">
                      TOTP is active on this account.
                    </span>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => totpDisableMutation.mutate()}
                    disabled={totpDisableMutation.isPending}
                  >
                    Disable
                  </Button>
                </div>
              ) : totpSetup ? (
                <div className="space-y-4">
                  <p className="text-sm">
                    Scan this QR code with your authenticator app, then enter the
                    6-digit code to confirm.
                  </p>
                  <div className="flex justify-center rounded bg-white p-4">
                    <QRCodeSVG value={totpSetup.qrUri} size={200} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Manual secret: <span className="font-mono">{totpSetup.secret}</span>
                  </p>
                  <div className="flex items-end gap-2">
                    <div className="flex-1 space-y-2">
                      <Label htmlFor="totp-code">Verification code</Label>
                      <Input
                        id="totp-code"
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={totpVerifyCode}
                        onChange={(e) => setTotpVerifyCode(e.target.value)}
                        placeholder="000000"
                      />
                    </div>
                    <Button
                      onClick={() => totpVerifyMutation.mutate()}
                      disabled={
                        totpVerifyMutation.isPending || totpVerifyCode.length !== 6
                      }
                    >
                      {totpVerifyMutation.isPending ? 'Verifying...' : 'Enable'}
                    </Button>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setTotpSetup(null)}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  onClick={() => totpSetupMutation.mutate()}
                  disabled={totpSetupMutation.isPending}
                >
                  {totpSetupMutation.isPending ? 'Setting up...' : 'Enable TOTP'}
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Accessibility */}
          <Card>
            <CardHeader>
              <CardTitle>Accessibility</CardTitle>
              <CardDescription>Color vision and motion preferences</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Color Vision</Label>
                <div className="space-y-2">
                  {COLORBLIND_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setColorBlindMode(opt.value)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors',
                        colorBlindMode === opt.value
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/30',
                      )}
                    >
                      <div className={cn(
                        'flex size-5 items-center justify-center rounded-full border-2',
                        colorBlindMode === opt.value ? 'border-primary' : 'border-muted-foreground/30',
                      )}>
                        {colorBlindMode === opt.value && <div className="size-2.5 rounded-full bg-primary" />}
                      </div>
                      <div>
                        <span className="text-sm font-medium">{opt.label}</span>
                        <p className="text-xs text-muted-foreground">{opt.description}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label>High contrast</Label>
                  <p className="text-xs text-muted-foreground">Increase border and text contrast</p>
                </div>
                <Switch checked={highContrast} onCheckedChange={setHighContrast} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label>Reduced motion</Label>
                  <p className="text-xs text-muted-foreground">Minimize animations and transitions</p>
                </div>
                <Switch checked={reducedMotion} onCheckedChange={setReducedMotion} />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Active Sessions -- full width below the grid */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Active Sessions</CardTitle>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive"
              onClick={() => toast.success('All other sessions terminated')}
            >
              Terminate all other sessions
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Device</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">IP</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Last Active</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Location</th>
                <th className="px-4 py-2.5 text-right" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {sessions.map((s, i) => (
                <tr key={i}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      {s.device}
                      {s.current && <Badge variant="secondary">Current</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{s.ip}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{s.lastActive}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{s.location}</td>
                  <td className="px-4 py-2.5 text-right">
                    {!s.current && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => toast.success('Session terminated')}
                      >
                        Terminate
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
