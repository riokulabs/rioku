import { useState, type FormEvent } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/hooks/use-auth'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

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
        <linearGradient id="login-hex-gradient" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
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

function LoginPage() {
  const { t } = useTranslation()
  const { login } = useAuth()
  const navigate = useNavigate()
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    const trimmed = token.trim()
    if (!trimmed) {
      setError('Please enter a valid API token.')
      return
    }

    setLoading(true)
    try {
      await login(trimmed)
      navigate({ to: '/' })
    } catch {
      setError('Invalid token. Please try again.')
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
          <CardDescription>{t('auth.login', 'Log in')} to your gateway</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="token">API Token</Label>
              <Input
                id="token"
                type="password"
                placeholder="Enter your API token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoFocus
                autoComplete="off"
              />
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Authenticating...' : t('auth.login', 'Log in')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
