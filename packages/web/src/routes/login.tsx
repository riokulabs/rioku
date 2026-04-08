import { useState, type FormEvent } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
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

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

function LoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [requiresTotp, setRequiresTotp] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const body: Record<string, string> = {
        username: username.trim(),
        password,
      }
      if (requiresTotp && totpCode.trim()) {
        body.totp_code = totpCode.trim()
      }

      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      })

      if (res.status === 401) {
        const data = await res.json().catch(() => ({}))
        if (data.requires_totp) {
          setRequiresTotp(true)
          setError('Enter your authenticator code.')
          return
        }
        setError('Invalid username or password.')
        return
      }

      if (res.status === 423) {
        setError('Account is locked. Try again later.')
        return
      }

      if (res.status === 403) {
        setError('Account suspended. Contact an administrator.')
        return
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.detail ?? 'Login failed.')
        return
      }

      // Root beforeLoad will handle force_password_change redirect
      await navigate({ to: '/' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <RiokuLogo />
          <CardTitle className="mt-2 text-xl">Rioku</CardTitle>
          <CardDescription>
            {t('auth.login', 'Log in')} to your gateway
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus={!requiresTotp}
                autoComplete="username"
                disabled={requiresTotp}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                disabled={requiresTotp}
              />
            </div>
            {requiresTotp && (
              <div className="space-y-2">
                <Label htmlFor="totp">Authenticator code</Label>
                <Input
                  id="totp"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  autoFocus
                  autoComplete="one-time-code"
                  placeholder="000000"
                />
              </div>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading
                ? 'Signing in...'
                : requiresTotp
                  ? 'Verify'
                  : t('auth.login', 'Log in')}
            </Button>
            {requiresTotp && (
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => {
                  setRequiresTotp(false)
                  setTotpCode('')
                  setError(null)
                }}
              >
                Back
              </Button>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

// Inline — identical to original login.tsx SVG, kept local to avoid a shared
// component import that triggers route tree regeneration.
function RiokuLogo() {
  return (
    <svg
      width="48"
      height="48"
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id="login-hex-gradient"
          x1="0"
          y1="0"
          x2="32"
          y2="32"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#a855f7" />
          <stop offset="100%" stopColor="#06b6d4" />
        </linearGradient>
      </defs>
      <path
        d="M16 2 L28.124 9 L28.124 23 L16 30 L3.876 23 L3.876 9 Z"
        fill="url(#login-hex-gradient)"
        opacity="0.9"
      />
      <text
        x="16"
        y="20"
        textAnchor="middle"
        fill="white"
        fontSize="14"
        fontWeight="700"
        fontFamily="sans-serif"
      >
        R
      </text>
    </svg>
  )
}
