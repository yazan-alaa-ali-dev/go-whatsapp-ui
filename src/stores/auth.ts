import { create } from 'zustand'
import {
  fetchMe,
  login,
  logout,
  refresh,
  type AuthTokenPair,
  type AuthUser,
  type LoginCredentials,
} from '@/api/auth'
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
 * Why a session ended, so the login screen can say something true about it
 * (z8pmx9md6z). It lives in memory and never in a cookie: it is a notice, not
 * session state, and the circumstances of a failed session are not something to
 * write into storage.
 */
export type SessionEndReason = 'signed-out' | 'expired' | 'permissions-changed'

/**
 * What one attempt at `POST /auth/refresh` produced (z8pmx9md70). "Failed" is
 * not one thing, and collapsing these three would be an auth bug either way:
 *
 * - `refreshed` — a new pair is held, in the store and in the cookies.
 * - `ended`     — the server judged the refresh token and refused it, so reuse
 *                 detection has revoked the whole family. Nothing to retry and
 *                 nothing to keep; the session is already cleared when this is
 *                 returned. Also returned, having touched nothing, when there
 *                 was no token to spend or the session moved on mid-flight.
 * - `deferred`  — the attempt failed for a reason that says nothing about the
 *                 token: a 429 from a bucket keyed on the TCP peer, a 5xx, a
 *                 transport failure. Nothing is torn down here and nothing is
 *                 retried; what the caller does about it depends on whether the
 *                 access token is still alive, which only the caller knows.
 */
export type RefreshOutcome = 'refreshed' | 'ended' | 'deferred'

/**
 * The audit record of one attempt. It is deliberately made of a verdict, a
 * number and a closed vocabulary — the one thing it must never carry is a
 * token, and the second is text somebody else wrote.
 */
export interface RefreshRecord {
  outcome: 'success' | 'failed'
  /** HTTP status, or 0 when the request never got an answer. */
  status: number
  /** Only a code from the reference's own §02 catalogue; otherwise null. */
  code: string | null
  at: string
}

/**
 * The error codes §02 defines. `toApiError` fills `code` from the response
 * envelope when there is one and falls back to `HTTP_ERROR` / `NETWORK_ERROR`
 * when there is not — so on a public route, in front of which any intermediary
 * may sit, `code` is attacker-influenceable text. Anything outside this list is
 * dropped rather than recorded.
 */
const CATALOGUE_CODES: ReadonlySet<string> = new Set([
  'AUTH_REQUIRED',
  'AUTH_INVALID_CREDENTIALS',
  'AUTH_INVALID_REFRESH_TOKEN',
  'AUTH_RATE_LIMITED',
  'AUTH_NOT_CONFIGURED',
  'AUTH_BUSY',
  'MALFORMED_TOKEN_PAIR',
])

/**
 * The one in-flight `POST /auth/refresh`, or null.
 *
 * Module scope rather than store state on purpose: it is not something a
 * component may render or a test may set, and putting a promise in a zustand
 * store would make every subscriber re-run when it settles.
 *
 * It is nulled in a `finally` and again in `clearSession`. Both matter. Without
 * the `finally` the promise is created once, settles, and is then handed to
 * every later caller forever: the page would refresh exactly once, and every
 * request after the second rotation would be replayed with a dead token.
 */
let inFlight: Promise<RefreshOutcome> | null = null

/**
 * How much the browser's clock is allowed to disagree with the server's before
 * a refusal is read as an administrative change rather than an ordinary expiry.
 */
const CLOCK_SKEW_MS = 60_000

/**
 * Why the server refused a token, inferred — because the server does not say.
 * The reference's `Authenticate` middleware identifies and never refuses, so a
 * 401 carries no cause; the one signal available is whether the access token
 * was still inside its own lifetime when it was refused, and the reference
 * documents exactly one thing that kills a live token: a `token_epoch` bump
 * from an administrative change.
 *
 * The bias is deliberate and points at the benign answer. `expired` is a
 * statement about a clock; `permissions-changed` is an accusation that an
 * administrator did something. Telling a user their permissions changed when
 * nothing happened invites a support ticket about an event that never occurred,
 * so an unreadable expiry (a cleared or tampered cookie) reads as *unknown*
 * rather than as *not expired*, and a token inside the skew window reads as
 * expired.
 */
export function refusalReason(
  expiresAt: number | null,
  now: number = Date.now(),
): SessionEndReason {
  if (expiresAt === null) return 'expired'
  return expiresAt <= now + CLOCK_SKEW_MS ? 'expired' : 'permissions-changed'
}

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
  lastRefresh: RefreshRecord | null
  user: { user_id: string; username: string; role: string; permissionCount: number } | null
}

export interface AuthState {
  access_token: string | null
  refresh_token: string | null
  /** Absolute epoch milliseconds. `expires_in` is converted once, on write. */
  access_token_expires_at: number | null
  user: AuthUser | null
  status: SessionStatus
  /** Set by whatever ended the session; read once by the login screen. */
  endReason: SessionEndReason | null
  /** The last refresh attempt, as an outcome. Never a token. */
  lastRefresh: RefreshRecord | null

  storeTokenPair: (pair: AuthTokenPair) => void
  signIn: (credentials: LoginCredentials) => Promise<void>
  signOut: () => void
  refreshSession: () => Promise<RefreshOutcome>
  recordRefresh: (outcome: RefreshRecord['outcome'], status: number, code: string | null) => void
  endSession: (reason: SessionEndReason) => void
  endRefusedSession: (reason?: SessionEndReason) => void
  clearSession: (reason?: SessionEndReason) => void
  consumeEndReason: () => SessionEndReason | null
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
  endReason: null,
  lastRefresh: null,

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
      // A new session answers whatever the last one's ending said.
      endReason: null,
    }))
  },

  /**
   * Exchange credentials for a session. Nothing is written unless the whole
   * exchange succeeds: a failed sign-in must not disturb a session that is
   * already held, and must not leave a partial one behind.
   */
  signIn: async (credentials) => {
    const pair = await login(credentials)
    get().storeTokenPair(pair)
    if (get().user) return

    // The reference has /auth/login return the principal, and storeTokenPair
    // marks the session authenticated when it does. A deployment that omitted
    // it would otherwise leave the session holding tokens but no principal —
    // and the route guard would bounce the user back to the screen that just
    // succeeded, forever. /auth/me is the authority for the principal anyway.
    try {
      set({ user: await fetchMe(), status: 'authenticated' })
    } catch (error) {
      get().clearSession()
      throw error
    }
  },

  /**
   * The **voluntary** teardown: the user asked to leave, so the refresh-token
   * family is revoked server-side and every cookie goes.
   *
   * The request is issued before the local clear so it carries the token, and
   * is never awaited so a server that does not answer cannot hold the sign-out
   * hostage. The `.catch` is load-bearing rather than decorative: an unhandled
   * rejection from a fire-and-forget promise is an unhandled rejection.
   */
  signOut: () => {
    const token = get().refresh_token
    if (token) {
      try {
        // `Promise.resolve` and the `try` are both about the same guarantee: no
        // behaviour of this call — a rejection, a promise that never settles, or
        // a synchronous throw before one is even returned — may reach the line
        // below. AC-21 says the local sign-out always happens, and "always" has
        // to include the ways this request can fail that are not a rejection.
        void Promise.resolve(logout(token)).catch(() => {})
      } catch {
        // The family expires on its own. The local session must not survive.
      }
    }
    get().clearSession('signed-out')
  },

  /**
   * Rotate the pair. The single place `POST /auth/refresh` is called from.
   *
   * **Single-flight.** Every caller that arrives while one is in the air gets
   * that same promise, which is what makes five concurrent 401s cost one POST
   * (AC-11) and what stops the proactive schedule racing the reactive path.
   * There is exactly one dedupe mechanism in this feature and this is it.
   *
   * **The identity check is the security property.** The presented token is
   * always spent server-side, and the answer can arrive after the session that
   * owned it is gone: a `signOut()` landing mid-flight would otherwise be
   * *undone* here — both cookies rewritten, a refresh token put back, the
   * sign-out notice erased, and the status flipped back to authenticated for a
   * user who pressed Log out. So the token that was spent must still be the
   * token the store holds, or the pair is dropped unwritten. A teardown nulls
   * it; a new sign-in replaces it; either way this is no longer our session.
   */
  refreshSession: async () => {
    if (inFlight) return inFlight

    const spent = get().refresh_token
    if (!spent) {
      // Nothing was spent, so nothing is torn down: deciding what a session
      // with no refresh token means belongs to the caller, and getting that
      // wrong here would overwrite a deliberate sign-out's notice.
      get().recordRefresh('failed', 0, null)
      return 'ended'
    }

    inFlight = (async (): Promise<RefreshOutcome> => {
      try {
        const pair = await refresh(spent)
        if (get().refresh_token !== spent) return 'ended'
        get().storeTokenPair(pair)
        get().recordRefresh('success', 200, null)
        return 'refreshed'
      } catch (error) {
        const { status, code } = toApiError(error)
        get().recordRefresh('failed', status, code)
        // The two ways the server says "this token is dead". Anything else —
        // 429 from a bucket keyed on the TCP peer, a 5xx, a socket that never
        // answered — is not a verdict on the token and must not be read as one.
        const refused = status === 401 || code === 'AUTH_INVALID_REFRESH_TOKEN'
        if (!refused) return 'deferred'
        if (get().refresh_token === spent) {
          // Read the reason before clearSession wipes the expiry it is computed
          // from. A live access token refused alongside its refresh token is
          // what a token_epoch bump looks like.
          get().clearSession(refusalReason(get().access_token_expires_at))
        }
        return 'ended'
      } finally {
        inFlight = null
      }
    })()

    return inFlight
  },

  /** Audit, never a value: an outcome, a status number, and a closed code set. */
  recordRefresh: (outcome, status, code) => {
    set({
      lastRefresh: {
        outcome,
        status,
        code: code !== null && CATALOGUE_CODES.has(code) ? code : null,
        at: new Date().toISOString(),
      },
    })
  },

  /**
   * The **involuntary** teardown: a token was refused or ran out. The access
   * token goes and the refresh token stays — deliberately, because it is the
   * credential the refresh path recovers with, and because `POST /auth/logout`
   * would revoke the whole family for an event the user did not ask for.
   */
  endSession: (reason) => {
    clearAccess()
    set({
      access_token: null,
      access_token_expires_at: null,
      user: null,
      status: 'anonymous',
      endReason: reason,
    })
  },

  /**
   * What the 401 interceptor calls. A `token_epoch` bump refuses every in-flight
   * request at once, so this must produce one teardown and not N: the status
   * check and the `set` that invalidates it are synchronous, in one function,
   * with no `await` between them. Do not insert one.
   *
   * A 401 without a session is not a session ending — it is an unauthenticated
   * request — so it is a no-op, which is also what absorbs the burst of refetch
   * 401s a cache teardown can produce before the guard unmounts the tree.
   */
  endRefusedSession: (reason) => {
    const { status, access_token_expires_at } = get()
    if (status !== 'authenticated') return
    // With a reason, the caller knows something this store cannot infer. The
    // reactive path uses that for a refresh that failed on a 429 or a 5xx: the
    // server judged nothing there, and inferring `permissions-changed` from a
    // still-live access token would tell a user an administrator changed their
    // account because somebody else exhausted a shared rate-limit bucket.
    get().endSession(reason ?? refusalReason(access_token_expires_at))
  },

  clearSession: (reason = 'signed-out') => {
    // A refresh in the air belongs to the session being torn down. Dropping the
    // reference lets the next session start its own; the identity check in
    // refreshSession is what stops the old one writing anything when it lands.
    inFlight = null
    clearAccess()
    removeCookie(REFRESH_COOKIE)
    set({
      access_token: null,
      refresh_token: null,
      access_token_expires_at: null,
      user: null,
      status: 'anonymous',
      endReason: reason,
    })
  },

  /** Read once and forget: a notice shown twice is a notice nobody believes. */
  consumeEndReason: () => {
    const reason = get().endReason
    if (reason !== null) set({ endReason: null })
    return reason
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
      // An expired access cookie buys nothing but a guaranteed 401. Drop it,
      // keep the refresh token, and spend it — this is the recovery the
      // previous ticket deferred to this one.
      if (expired) clearAccess()
      // This write happens BEFORE any await, and that ordering is the whole
      // StrictMode latch: `status` stops being 'unknown' here, so React's second
      // invocation of the boot effect returns at the guard above instead of
      // issuing a second refresh and a second GET /auth/me. Do not move an
      // await above this line.
      set({
        access_token: null,
        refresh_token: refreshToken,
        access_token_expires_at: null,
        user: null,
        status: 'anonymous',
      })
      if (!refreshToken) return
      // `ended` has already cleared the session; `deferred` leaves the refresh
      // token in place, and the next reload tries again. Either way there is no
      // access token to ask /auth/me with, so there is nothing more to do here.
      if ((await get().refreshSession()) !== 'refreshed') return
    } else {
      set({
        access_token: accessToken,
        refresh_token: refreshToken,
        access_token_expires_at: expiresAt,
      })
    }

    try {
      const user = await fetchMe()
      set({ user, status: 'authenticated' })
    } catch (error) {
      // A 401 means the token is refused — a token-epoch bump is the documented
      // cause — so it is dropped, with the reason the login screen will show.
      // This is the same narrow teardown as before: `endSession` keeps the
      // refresh token, because recovering from this is z8pmx9md70's job, and it
      // never issues POST /auth/logout, which would revoke a family the server
      // may not have invalidated.
      if (toApiError(error).status === 401) {
        get().endSession(refusalReason(get().access_token_expires_at))
        return
      }
      // Anything else (network, 5xx, a malformed envelope) said nothing about
      // the token, so the token is kept and the next reload tries again. No
      // reason is recorded either: nothing here is evidence the session ended.
      set({ user: null, status: 'anonymous' })
    }
  },

  /**
   * What may be shown to a human or written to a log: whether a token is held,
   * never which one. No token value can reach this output.
   */
  diagnostics: () => {
    const { status, access_token, refresh_token, access_token_expires_at, user, lastRefresh } =
      get()
    return {
      status,
      hasAccessToken: access_token !== null,
      hasRefreshToken: refresh_token !== null,
      accessTokenExpiresAt:
        access_token_expires_at === null ? null : new Date(access_token_expires_at).toISOString(),
      lastRefresh,
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
