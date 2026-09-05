import { create } from 'zustand'
import { fetchMe, type AuthTokenPair, type AuthUser } from '@/api/auth'
import { toApiError } from '@/lib/api-error'
import { getCookie, removeCookie, setCookie } from '@/lib/cookies'

/**
 * The one place the session lives.
 *
 * Every read of a token goes through this store and every write goes through an
 * action on it — that is the whole point of the ticket. If two modules could
 * each answer "what is the current session?", the moment they disagreed the
 * disagreement would be an auth bug.
 *
 * Persistence is cookies, through `@/lib/cookies`, and nothing else. No token,
 * password or credential is written to `localStorage` or `sessionStorage`, and
 * `src/lib/source-policy.test.ts` fails the build if one ever is.
 */

/**
 * `unknown` is the pre-boot state: a token may be in a cookie and nobody has
 * asked the server yet. It is distinct from `anonymous`, which is an answer.
 */
export type SessionStatus = 'unknown' | 'anonymous' | 'authenticated'

/**
 * Versioned names, like every other persisted state in this repository: a
 * changed shape means a changed name, so a browser holding the old shape is
 * ignored rather than misread.
 */
const ACCESS_COOKIE = 'gowa-ui.access.v1'
const REFRESH_COOKIE = 'gowa-ui.refresh.v1'
const ACCESS_EXPIRES_COOKIE = 'gowa-ui.access_expires.v1'

/**
 * The refresh token's own lifetime (reference §03: 30 days). It is a constant
 * rather than a response field because the server reports `expires_in` for the
 * access token alone — there is no second number to read.
 */
const REFRESH_MAX_AGE_SECONDS = 30 * 24 * 60 * 60

export interface SessionDiagnostics {
  status: SessionStatus
  hasAccessToken: boolean
  hasRefreshToken: boolean
  accessTokenExpiresAt: string | null
  user: { user_id: string; username: string; role: string; permissionCount: number } | null
}

export interface AuthState {
  access_token: string | null
  refresh_token: string | null
  /** Absolute epoch milliseconds. `expires_in` is converted once, on write. */
  access_token_expires_at: number | null
  user: AuthUser | null
  status: SessionStatus

  storeTokenPair: (pair: AuthTokenPair) => void
  clearSession: () => void
  boot: () => Promise<void>
  diagnostics: () => SessionDiagnostics
}

/** Cookie writes live here and nowhere else, so the names have one owner. */
function writeAccess(token: string, expiresAt: number, maxAgeSeconds: number): void {
  setCookie(ACCESS_COOKIE, token, maxAgeSeconds)
  setCookie(ACCESS_EXPIRES_COOKIE, String(expiresAt), maxAgeSeconds)
}

function clearAccess(): void {
  removeCookie(ACCESS_COOKIE)
  removeCookie(ACCESS_EXPIRES_COOKIE)
}

function readExpiresAt(): number | null {
  const raw = getCookie(ACCESS_EXPIRES_COOKIE)
  if (!raw) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

export const useAuth = create<AuthState>()((set, get) => ({
  access_token: null,
  refresh_token: null,
  access_token_expires_at: null,
  user: null,
  status: 'unknown',

  /**
   * The only conversion of `expires_in` in the codebase: seconds, describing
   * the access token alone, become one absolute timestamp here and are never
   * kept as a second copy. The access cookie's own lifetime is that same
   * number, so the browser drops the token exactly when it dies.
   */
  storeTokenPair: (pair) => {
    const expiresAt = Date.now() + pair.expires_in * 1000
    writeAccess(pair.access_token, expiresAt, pair.expires_in)
    setCookie(REFRESH_COOKIE, pair.refresh_token, REFRESH_MAX_AGE_SECONDS)
    set((state) => ({
      access_token: pair.access_token,
      refresh_token: pair.refresh_token,
      access_token_expires_at: expiresAt,
      user: pair.user ?? state.user,
      status: (pair.user ?? state.user) ? 'authenticated' : state.status,
    }))
  },

  clearSession: () => {
    clearAccess()
    removeCookie(REFRESH_COOKIE)
    set({
      access_token: null,
      refresh_token: null,
      access_token_expires_at: null,
      user: null,
      status: 'anonymous',
    })
  },

  /**
   * Rehydrate a session that already exists in cookies. Nothing here creates
   * one — logging in is `z8pmx9md6z`.
   *
   * Two properties this is written for, both load-bearing:
   *
   * 1. **Exactly one `/auth/me`.** StrictMode invokes the boot effect twice in
   *    development, so the latch is the session state itself: the first call
   *    makes `status === 'unknown' && access_token === null` false before its
   *    first `await`, and the second returns immediately. No extra field, and
   *    nothing to reset in a test.
   * 2. **The token is readable synchronously.** Cookie hydration and the state
   *    write happen in that same synchronous run, so no request can leave
   *    without the bearer header while boot is still in flight.
   */
  boot: async () => {
    const current = get()
    if (current.status !== 'unknown' || current.access_token !== null) return

    const accessToken = getCookie(ACCESS_COOKIE)
    const refreshToken = getCookie(REFRESH_COOKIE)
    const expiresAt = readExpiresAt()
    const expired = expiresAt !== null && expiresAt <= Date.now()

    if (!accessToken || expired) {
      // An expired access cookie buys nothing but a guaranteed 401. Drop it and
      // leave the refresh token alone — recovering from this is z8pmx9md70's.
      if (expired) clearAccess()
      set({
        access_token: null,
        refresh_token: refreshToken,
        access_token_expires_at: null,
        user: null,
        status: 'anonymous',
      })
      return
    }

    set({
      access_token: accessToken,
      refresh_token: refreshToken,
      access_token_expires_at: expiresAt,
    })

    try {
      const user = await fetchMe()
      set({ user, status: 'authenticated' })
    } catch (error) {
      // A 401 means the token is refused — a token-epoch bump is the documented
      // cause — so it is dropped. Anything else (network, 5xx, a malformed
      // envelope) said nothing about the token, so the token is kept and the
      // next reload tries again. Either way the refresh token survives: this
      // ticket stops at "not authenticated" on purpose.
      const refused = toApiError(error).status === 401
      if (refused) clearAccess()
      set({
        access_token: refused ? null : get().access_token,
        access_token_expires_at: refused ? null : get().access_token_expires_at,
        user: null,
        status: 'anonymous',
      })
    }
  },

  /**
   * What may be shown to a human or written to a log: whether a token is held,
   * never which one. No token value can reach this output.
   */
  diagnostics: () => {
    const { status, access_token, refresh_token, access_token_expires_at, user } = get()
    return {
      status,
      hasAccessToken: access_token !== null,
      hasRefreshToken: refresh_token !== null,
      accessTokenExpiresAt:
        access_token_expires_at === null ? null : new Date(access_token_expires_at).toISOString(),
      user: user
        ? {
            user_id: user.user_id,
            username: user.username,
            role: user.role,
            permissionCount: user.permissions.length,
          }
        : null,
    }
  },
}))
