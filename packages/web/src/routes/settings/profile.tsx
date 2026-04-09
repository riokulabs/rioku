import { useState, type FormEvent } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
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
import { apiClient } from '@/lib/api'

export const Route = createFileRoute('/settings/profile')({
  component: ProfilePage,
})

function ProfilePage() {
  const { session } = Route.useRouteContext() as { session: import('@/lib/api').MeResponse }
  const user = session.user
  const queryClient = useQueryClient()

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
      <PageHeader title="Profile" description="Manage your account settings" />

      {/* Profile */}
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
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
            className="space-y-4"
          >
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
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={profileMutation.isPending}>
              {profileMutation.isPending ? 'Saving...' : 'Save changes'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Password */}
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
    </div>
  )
}
