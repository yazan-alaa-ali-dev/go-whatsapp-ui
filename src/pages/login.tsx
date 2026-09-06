import { useCallback, useState, type FormEvent } from 'react'
import { AlertTriangle, LogIn, PlugZap } from 'lucide-react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Logo } from '@/components/layout/logo'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RetryCountdown } from '@/features/auth/retry-countdown'
import { toApiError } from '@/lib/api-error'
import {
  CONNECTION_NOTICES,
  SIGN_OUT_NOTICES,
  toLoginError,
  type LoginError,
  type Notice,
} from '@/lib/auth-messages'
import { afterLoginPath, HOME_PATH } from '@/lib/session-route'
import { useAuth } from '@/stores/auth'
import { useConnection } from '@/stores/connection'

/**
 * The screen that replaced the connect screen.
 *
 * There is no Server URL field and there never will be again: since z8pmx9md6x
 * the dashboard talks to its own origin, so the only things a human can supply
 * are the two the server asks for.
 *
 * The page is public and outside the route guard. `POST /auth/login` is sent
 * without an `Authorization` header (see `src/lib/http.ts`), so a stale or
 * corrupt token sitting in a cookie cannot change what happens here.
 */
export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()

  const status = useAuth((state) => state.status)
  const signIn = useAuth((state) => state.signIn)
  const connection = useConnection((state) => state.status)
  const probe = useConnection((state) => state.boot)

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<LoginError | null>(null)
  const [retryAt, setRetryAt] = useState<number | null>(null)
  const [reprobing, setReprobing] = useState(false)
  // Once the server has answered anything at all — a token, a refusal, a rate
  // limit — it has demonstrably been reached, whatever the health probe thinks.
  // Without this the banner would sit permanently above a working form on any
  // deployment that proxies /api but not /health.
  const [serverAnswered, setServerAnswered] = useState(false)

  /**
   * Everything the previous session left behind, read exactly once on arrival —
   * in one initializer, because consuming the reason is what erases it and a
   * second reader would find nothing.
   *
   * A deliberate sign-out deliberately forgets the destination: the guard
   * stamps whatever page the user was on when they pressed Log out, and sending
   * the *next* person to sign in straight to it is not what AC-7 is for.
   */
  const [arrival] = useState<{ notice: Notice | null; from: unknown }>(() => {
    const reason = useAuth.getState().consumeEndReason()
    return {
      notice: reason ? SIGN_OUT_NOTICES[reason] : null,
      from: reason === 'signed-out' ? null : (location.state as { from?: unknown } | null)?.from,
    }
  })

  const clearWait = useCallback(() => setRetryAt(null), [])

  if (status === 'authenticated') return <Navigate to={HOME_PATH} replace />

  const waiting = retryAt !== null
  const incomplete = username.trim() === '' || password === ''
  const blocked = submitting || incomplete || waiting

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    // Without this the browser performs a native GET and puts the password in
    // the URL, the address bar and the history.
    event.preventDefault()
    if (blocked) return

    setSubmitting(true)
    setError(null)
    try {
      await signIn({ username: username.trim(), password })
      setServerAnswered(true)
      const target = afterLoginPath(arrival.from)
      navigate(target, { replace: true })
    } catch (cause) {
      // Every rejection out of the shared client is already an ApiError — the
      // response interceptor converts it — so the AxiosError, whose config.data
      // still holds the plaintext password, never reaches this page at all.
      const apiError = toApiError(cause)
      if (apiError.status > 0) setServerAnswered(true)
      const failure = toLoginError(apiError)
      setError(failure)
      if (failure.retryAfterSeconds) {
        setRetryAt(Date.now() + failure.retryAfterSeconds * 1000)
      }
    } finally {
      // The password is sent once. It is not kept, here or anywhere else.
      setPassword('')
      setSubmitting(false)
    }
  }

  const retryProbe = async () => {
    setReprobing(true)
    await probe()
    setReprobing(false)
  }

  const connectionNotice =
    !serverAnswered && (connection === 'unreachable' || connection === 'unauthorized')
      ? CONNECTION_NOTICES[connection]
      : null

  return (
    <div className="bg-background relative flex min-h-svh items-center justify-center overflow-hidden p-4">
      <div
        aria-hidden
        className="bg-[radial-gradient(ellipse_at_top,--theme(--color-primary/12%),transparent_60%)] pointer-events-none absolute inset-0"
      />
      <Card className="animate-in fade-in slide-in-from-bottom-2 relative w-full max-w-md duration-500">
        <CardHeader>
          <Logo className="mb-2 [&_img]:size-10 [&_span]:text-xl" />
          <CardTitle className="flex items-center gap-2">
            <LogIn className="text-muted-foreground size-5" />
            Sign in
          </CardTitle>
          <CardDescription>
            Use the username and password for this server. There is nothing else to configure — the
            dashboard talks to its own origin.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          {arrival.notice && (
            <div className="bg-muted/50 text-muted-foreground rounded-lg border p-3 text-sm">
              <p className="text-foreground font-medium">{arrival.notice.title}</p>
              <p className="mt-1">{arrival.notice.description}</p>
            </div>
          )}

          {connectionNotice && (
            <div className="bg-muted/50 text-muted-foreground rounded-lg border p-3 text-sm">
              <p className="text-foreground flex items-center gap-2 font-medium">
                <PlugZap className="size-4" />
                {connectionNotice.title}
              </p>
              <p className="mt-1">{connectionNotice.description}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={retryProbe}
                disabled={reprobing}
              >
                Try again
              </Button>
            </div>
          )}

          <form className="flex flex-col gap-4" onSubmit={submit}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                name="username"
                autoComplete="username"
                autoFocus
                required
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                disabled={submitting}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={submitting}
              />
            </div>

            {error && (
              <div
                role="alert"
                className="border-destructive/40 bg-destructive/5 text-muted-foreground rounded-lg border p-3 text-sm"
              >
                <p className="text-foreground flex items-center gap-2 font-medium">
                  <AlertTriangle className="text-destructive size-4" />
                  {error.title}
                </p>
                <p className="mt-1">{error.description}</p>
              </div>
            )}

            <Button type="submit" disabled={blocked} className="w-full">
              {waiting && retryAt !== null ? (
                <>
                  Try again in <RetryCountdown retryAt={retryAt} onElapsed={clearWait} />
                </>
              ) : (
                'Sign in'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
