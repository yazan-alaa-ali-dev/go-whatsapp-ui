import { Loader2 } from 'lucide-react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { LOGIN_PATH } from '@/lib/session-route'
import { useAuth } from '@/stores/auth'

/**
 * The route guard: no session, no application.
 *
 * `unknown` is not `anonymous`, and the difference is the whole reason
 * z8pmx9md6y introduced a third state. On a reload with a valid cookie the
 * session is not yet known — showing the login form during that window would
 * flash a sign-in screen at a user who is signed in, and redirecting away from
 * it would be worse. So `unknown` waits, and only an answered `anonymous`
 * redirects.
 *
 * The store is read through a selector rather than whole. This component sits
 * above `AppShell`, so its every render is a render of the entire protected
 * tree — and `storeTokenPair` writes four fields at once, which is exactly what
 * z8pmx9md70's silent refresh will do every fifteen minutes.
 */
export function RequireSession() {
  const status = useAuth((state) => state.status)
  const location = useLocation()

  if (status === 'unknown') {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Loader2 className="text-muted-foreground size-6 animate-spin" />
      </div>
    )
  }

  if (status !== 'authenticated') {
    // The refused destination travels in router state so the login screen can
    // hand it back. It is a Location the router itself produced, and it is
    // validated anyway before anything navigates to it — see session-route.ts.
    return <Navigate to={LOGIN_PATH} state={{ from: location }} replace />
  }

  return <Outlet />
}
