import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchMe, login, logout, refresh, type AuthTokenPair, type AuthUser } from '@/api/auth'
import type { ApiError } from '@/api/types'
import { refusalReason, useAuth } from './auth'

vi.mock('@/api/auth', () => ({
  fetchMe: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  refresh: vi.fn(),
}))

const ACCESS = 'gowa-ui.access.v1'
const REFRESH = 'gowa-ui.refresh.v1'
const EXPIRES = 'gowa-ui.access_expires.v1'

const ACCESS_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.header-payload.signature'
const REFRESH_TOKEN = '8Kx2vQ1mZp9Lr7Ns4Td6Yb0Wc3Fh5Jg8Ae1Ru2Oi4M'

const principal: AuthUser = {
  user_id: 'usr_01',
  username: 'admin',
  account_id: 'acc_01',
  role: 'admin',
  roles: ['admin'],
  permissions: ['chats.read', 'messages.send'],
  status: 'active',
}

/** A `document.cookie` stand-in that behaves the way the browser's does. */
function cookieJar() {
  const jar = new Map<string, string>()
  vi.stubGlobal('document', {
    get cookie() {
      return [...jar].map(([name, value]) => `${name}=${value}`).join('; ')
    },
    set cookie(entry: string) {
      const [pair] = entry.split(';')
      const index = pair.indexOf('=')
      const name = pair.slice(0, index)
      if (entry.includes('Max-Age=0')) jar.delete(name)
      else jar.set(name, pair.slice(index + 1))
    },
  })
  return jar
}

function maxAgeOf(entry: string): number {
  return Number(/Max-Age=(\d+)/.exec(entry)?.[1])
}

let jar: Map<string, string>

beforeEach(() => {
  jar = cookieJar()
  useAuth.setState({
    access_token: null,
    refresh_token: null,
    access_token_expires_at: null,
    user: null,
    status: 'unknown',
    endReason: null,
    lastRefresh: null,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.mocked(fetchMe).mockReset()
  vi.mocked(login).mockReset()
  vi.mocked(logout).mockReset()
  vi.mocked(refresh).mockReset()
})

describe('storeTokenPair', () => {
  it('converts expires_in once into an absolute timestamp and keeps no second copy', () => {
    const before = Date.now()
    useAuth.getState().storeTokenPair({
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN,
      expires_in: 900,
      user: principal,
    })

    const state = useAuth.getState()
    expect(state.access_token_expires_at).toBeGreaterThanOrEqual(before + 900_000)
    expect(state.access_token_expires_at).toBeLessThanOrEqual(Date.now() + 900_000)
    expect(state).not.toHaveProperty('expires_in')
    expect(state.status).toBe('authenticated')
    expect(state.user?.permissions).toEqual(['chats.read', 'messages.send'])
  })

  it('gives each cookie its own token lifetime, not a shared one', () => {
    const writes: string[] = []
    vi.stubGlobal('document', {
      get cookie() {
        return ''
      },
      set cookie(entry: string) {
        writes.push(entry)
      },
    })

    useAuth.getState().storeTokenPair({
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN,
      expires_in: 900,
    })

    const access = writes.find((entry) => entry.startsWith(`${ACCESS}=`))!
    const refresh = writes.find((entry) => entry.startsWith(`${REFRESH}=`))!
    const expires = writes.find((entry) => entry.startsWith(`${EXPIRES}=`))!
    expect(maxAgeOf(access)).toBe(900)
    expect(maxAgeOf(expires)).toBe(900)
    expect(maxAgeOf(refresh)).toBe(2_592_000)
    for (const entry of [access, refresh, expires]) {
      expect(entry).toContain('Path=/')
      expect(entry).toContain('SameSite=Strict')
    }
  })

  it('persists nothing to web storage — there is no storage call to make', () => {
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', { setItem, getItem: () => null, removeItem: vi.fn() })
    vi.stubGlobal('sessionStorage', { setItem, getItem: () => null, removeItem: vi.fn() })

    useAuth.getState().storeTokenPair({
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN,
      expires_in: 900,
    })

    expect(setItem).not.toHaveBeenCalled()
  })
})

describe('boot', () => {
  it('asks the server nothing when there is no session to rehydrate', async () => {
    await useAuth.getState().boot()
    expect(fetchMe).not.toHaveBeenCalled()
    expect(useAuth.getState().status).toBe('anonymous')
  })

  it('makes GET /auth/me the authority for user and permissions', async () => {
    jar.set(ACCESS, ACCESS_TOKEN)
    jar.set(REFRESH, REFRESH_TOKEN)
    jar.set(EXPIRES, String(Date.now() + 900_000))
    vi.mocked(fetchMe).mockResolvedValue(principal)

    await useAuth.getState().boot()

    expect(fetchMe).toHaveBeenCalledTimes(1)
    expect(useAuth.getState().user).toEqual(principal)
    expect(useAuth.getState().user?.permissions).toEqual(['chats.read', 'messages.send'])
    expect(useAuth.getState().status).toBe('authenticated')
  })

  it('calls /auth/me exactly once even though StrictMode boots twice', async () => {
    jar.set(ACCESS, ACCESS_TOKEN)
    jar.set(EXPIRES, String(Date.now() + 900_000))
    vi.mocked(fetchMe).mockResolvedValue(principal)

    await Promise.all([useAuth.getState().boot(), useAuth.getState().boot()])
    await useAuth.getState().boot()

    expect(fetchMe).toHaveBeenCalledTimes(1)
  })

  it('publishes the token synchronously, so no request can leave without the header', () => {
    jar.set(ACCESS, ACCESS_TOKEN)
    jar.set(EXPIRES, String(Date.now() + 900_000))
    vi.mocked(fetchMe).mockResolvedValue(principal)

    const settled = useAuth.getState().boot()

    expect(useAuth.getState().access_token).toBe(ACCESS_TOKEN)
    return settled
  })

  it('spends no request on an expired token, and keeps the refresh token', async () => {
    jar.set(ACCESS, ACCESS_TOKEN)
    jar.set(REFRESH, REFRESH_TOKEN)
    jar.set(EXPIRES, String(Date.now() - 1_000))

    await useAuth.getState().boot()

    expect(fetchMe).not.toHaveBeenCalled()
    expect(useAuth.getState().status).toBe('anonymous')
    expect(useAuth.getState().refresh_token).toBe(REFRESH_TOKEN)
    expect(jar.has(ACCESS)).toBe(false)
    expect(jar.has(REFRESH)).toBe(true)
  })

  it('leaves the refresh token intact when /auth/me answers 401', async () => {
    jar.set(ACCESS, ACCESS_TOKEN)
    jar.set(REFRESH, REFRESH_TOKEN)
    jar.set(EXPIRES, String(Date.now() + 900_000))
    vi.mocked(fetchMe).mockRejectedValue({ status: 401, code: 'UNAUTHORIZED', message: 'no' })

    await useAuth.getState().boot()

    const state = useAuth.getState()
    expect(state.status).toBe('anonymous')
    expect(state.user).toBeNull()
    expect(state.access_token).toBeNull()
    expect(state.refresh_token).toBe(REFRESH_TOKEN)
    expect(jar.get(REFRESH)).toBe(REFRESH_TOKEN)
    // A token still inside its own lifetime that the server refused anyway is
    // the token-epoch case (reference §03), and the login screen says so.
    expect(state.endReason).toBe('permissions-changed')
  })

  it('never revokes the refresh-token family on an involuntary end', async () => {
    jar.set(ACCESS, ACCESS_TOKEN)
    jar.set(REFRESH, REFRESH_TOKEN)
    jar.set(EXPIRES, String(Date.now() + 900_000))
    vi.mocked(fetchMe).mockRejectedValue({ status: 401, code: 'UNAUTHORIZED', message: 'no' })

    await useAuth.getState().boot()

    // POST /auth/logout kills the whole family. Firing it for an event the user
    // did not ask for would destroy the credential z8pmx9md70 recovers with.
    expect(logout).not.toHaveBeenCalled()
  })

  it('keeps the access token when the failure said nothing about it', async () => {
    jar.set(ACCESS, ACCESS_TOKEN)
    jar.set(REFRESH, REFRESH_TOKEN)
    jar.set(EXPIRES, String(Date.now() + 900_000))
    vi.mocked(fetchMe).mockRejectedValue({ status: 0, code: 'NETWORK_ERROR', message: 'offline' })

    await useAuth.getState().boot()

    expect(useAuth.getState().status).toBe('anonymous')
    expect(useAuth.getState().access_token).toBe(ACCESS_TOKEN)
    expect(jar.get(ACCESS)).toBe(ACCESS_TOKEN)
  })

  it('treats an envelope with no principal as a failed rehydration', async () => {
    jar.set(ACCESS, ACCESS_TOKEN)
    jar.set(EXPIRES, String(Date.now() + 900_000))
    vi.mocked(fetchMe).mockRejectedValue({
      status: 0,
      code: 'MALFORMED_PRINCIPAL',
      message: 'no principal',
    })

    await useAuth.getState().boot()

    expect(useAuth.getState().status).toBe('anonymous')
    expect(useAuth.getState().user).toBeNull()
  })
})

describe('clearSession', () => {
  it('removes every session cookie, not only the access token', () => {
    jar.set(ACCESS, ACCESS_TOKEN)
    jar.set(REFRESH, REFRESH_TOKEN)
    jar.set(EXPIRES, '123')

    useAuth.getState().clearSession()

    expect([...jar.keys()]).toEqual([])
    expect(useAuth.getState().status).toBe('anonymous')
    expect(useAuth.getState().refresh_token).toBeNull()
  })
})

describe('diagnostics', () => {
  it('reports the session without naming either token', () => {
    useAuth.getState().storeTokenPair({
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN,
      expires_in: 900,
      user: principal,
    })

    const serialised = JSON.stringify(useAuth.getState().diagnostics())

    expect(serialised).not.toContain(ACCESS_TOKEN)
    expect(serialised).not.toContain(REFRESH_TOKEN)
    expect(useAuth.getState().diagnostics()).toMatchObject({
      status: 'authenticated',
      hasAccessToken: true,
      hasRefreshToken: true,
      user: { username: 'admin', role: 'admin', permissionCount: 2 },
    })
  })

  it('reports an anonymous session as anonymous', () => {
    expect(useAuth.getState().diagnostics()).toMatchObject({
      status: 'unknown',
      hasAccessToken: false,
      hasRefreshToken: false,
      accessTokenExpiresAt: null,
      user: null,
    })
  })
})

describe('signIn (TC-1, TC-2)', () => {
  it('stores the pair and the principal the server returned', async () => {
    vi.mocked(login).mockResolvedValue({
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN,
      expires_in: 900,
      user: principal,
    })

    await useAuth.getState().signIn({ username: 'admin', password: 'hunter2' })

    const state = useAuth.getState()
    expect(login).toHaveBeenCalledWith({ username: 'admin', password: 'hunter2' })
    expect(state.status).toBe('authenticated')
    expect(state.user).toEqual(principal)
    expect(jar.get(ACCESS)).toBe(ACCESS_TOKEN)
    expect(jar.get(REFRESH)).toBe(REFRESH_TOKEN)
    // /auth/login already answered with the principal; there is nothing to ask.
    expect(fetchMe).not.toHaveBeenCalled()
  })

  it('writes no session and no cookie when the credentials are refused', async () => {
    vi.mocked(login).mockRejectedValue({
      status: 401,
      code: 'AUTH_INVALID_CREDENTIALS',
      message: 'nope',
    })

    await expect(
      useAuth.getState().signIn({ username: 'admin', password: 'wrong' }),
    ).rejects.toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' })

    expect(useAuth.getState().access_token).toBeNull()
    expect([...jar.keys()]).toEqual([])
  })

  it('falls back to /auth/me when the pair carried no principal', async () => {
    // Without this the session would hold tokens and no user, the guard would
    // refuse it, and the user would bounce off a screen that just succeeded.
    vi.mocked(login).mockResolvedValue({
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN,
      expires_in: 900,
    })
    vi.mocked(fetchMe).mockResolvedValue(principal)

    await useAuth.getState().signIn({ username: 'admin', password: 'hunter2' })

    expect(fetchMe).toHaveBeenCalledTimes(1)
    expect(useAuth.getState().status).toBe('authenticated')
  })

  it('leaves no half-session behind when that fallback fails', async () => {
    vi.mocked(login).mockResolvedValue({
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN,
      expires_in: 900,
    })
    vi.mocked(fetchMe).mockRejectedValue({ status: 500, code: 'HTTP_ERROR', message: 'boom' })

    await expect(
      useAuth.getState().signIn({ username: 'admin', password: 'hunter2' }),
    ).rejects.toMatchObject({ status: 500 })

    expect(useAuth.getState().access_token).toBeNull()
    expect([...jar.keys()]).toEqual([])
  })
})

describe('signOut — the voluntary teardown (TC-5, TC-6)', () => {
  function signedIn(): void {
    useAuth.getState().storeTokenPair({
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN,
      expires_in: 900,
      user: principal,
    })
  }

  it('revokes the family with the refresh token, then clears everything', () => {
    vi.mocked(logout).mockResolvedValue(undefined)
    signedIn()

    useAuth.getState().signOut()

    expect(logout).toHaveBeenCalledWith(REFRESH_TOKEN)
    expect([...jar.keys()]).toEqual([])
    expect(useAuth.getState().status).toBe('anonymous')
    expect(useAuth.getState().refresh_token).toBeNull()
  })

  it('clears locally even when the server refuses the logout', () => {
    vi.mocked(logout).mockRejectedValue(new Error('500'))
    signedIn()

    useAuth.getState().signOut()

    expect([...jar.keys()]).toEqual([])
    expect(useAuth.getState().status).toBe('anonymous')
  })

  it('does not wait for a logout that never answers (AC-21)', () => {
    // The whole point: the local sign-out is complete before the request could
    // possibly have settled, so a hung server cannot hold the user hostage.
    vi.mocked(logout).mockReturnValue(new Promise<void>(() => {}))
    signedIn()

    useAuth.getState().signOut()

    expect(useAuth.getState().status).toBe('anonymous')
    expect([...jar.keys()]).toEqual([])
  })

  it('clears locally even when the request throws before returning a promise', () => {
    // Not a hypothetical shape of failure to guard against on principle: it is
    // the one way a rejection handler cannot help, and AC-21 says the local
    // sign-out always happens.
    vi.mocked(logout).mockImplementation(() => {
      throw new Error('threw synchronously')
    })
    signedIn()

    useAuth.getState().signOut()

    expect(useAuth.getState().status).toBe('anonymous')
    expect([...jar.keys()]).toEqual([])
  })

  it('records a deliberate sign-out, which the login screen shows nothing for', () => {
    vi.mocked(logout).mockResolvedValue(undefined)
    signedIn()
    useAuth.getState().signOut()
    expect(useAuth.getState().endReason).toBe('signed-out')
  })
})

describe('refusalReason — why the server refused (C-2)', () => {
  const now = 1_700_000_000_000

  it('reads a live token that was refused as an administrative change', () => {
    expect(refusalReason(now + 10 * 60_000, now)).toBe('permissions-changed')
  })

  it('reads an already-dead token as an ordinary expiry', () => {
    expect(refusalReason(now - 1, now)).toBe('expired')
  })

  it('gives the benign verdict the benefit of a skewed clock', () => {
    // A browser clock a little behind the server would otherwise accuse an
    // administrator of a change that never happened.
    expect(refusalReason(now + 30_000, now)).toBe('expired')
    expect(refusalReason(now + 61_000, now)).toBe('permissions-changed')
  })

  it('treats an unreadable expiry as unknown, not as "still valid"', () => {
    // A cleared or tampered expiry cookie must not turn every refusal into the
    // epoch message.
    expect(refusalReason(null, now)).toBe('expired')
  })
})

describe('endSession and endRefusedSession — the involuntary teardown', () => {
  function signedIn(expiresIn = 900): void {
    useAuth.getState().storeTokenPair({
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN,
      expires_in: expiresIn,
      user: principal,
    })
  }

  it('drops the access token and keeps the refresh token', () => {
    signedIn()

    useAuth.getState().endSession('expired')

    const state = useAuth.getState()
    expect(state.access_token).toBeNull()
    expect(state.status).toBe('anonymous')
    expect(state.endReason).toBe('expired')
    // Kept on purpose: it is what z8pmx9md70 will recover with.
    expect(state.refresh_token).toBe(REFRESH_TOKEN)
    expect(jar.has(ACCESS)).toBe(false)
    expect(jar.get(REFRESH)).toBe(REFRESH_TOKEN)
    expect(logout).not.toHaveBeenCalled()
  })

  it('ends a live session that was refused as a permissions change (TC-7)', () => {
    signedIn()
    useAuth.getState().endRefusedSession()
    expect(useAuth.getState().endReason).toBe('permissions-changed')
  })

  it('ends an expired session as an expiry', () => {
    signedIn(-1)
    useAuth.getState().endRefusedSession()
    expect(useAuth.getState().endReason).toBe('expired')
  })

  it('does nothing when no session is held', () => {
    useAuth.getState().endRefusedSession()
    expect(useAuth.getState().status).toBe('unknown')
    expect(useAuth.getState().endReason).toBeNull()
  })

  it('produces one teardown for a burst of refusals, not one each', () => {
    // A token-epoch bump 401s every in-flight request at once. The status check
    // and the write that invalidates it are synchronous in one function; an
    // await inserted between them would reopen this.
    signedIn()
    let ends = 0
    const stop = useAuth.subscribe((state, previous) => {
      if (previous.status === 'authenticated' && state.status !== 'authenticated') ends += 1
    })

    for (let i = 0; i < 5; i++) useAuth.getState().endRefusedSession()
    stop()

    expect(ends).toBe(1)
  })
})

describe('the sign-out reason is a notice, not state', () => {
  it('is read exactly once', () => {
    useAuth.getState().endSession('expired')

    expect(useAuth.getState().consumeEndReason()).toBe('expired')
    expect(useAuth.getState().consumeEndReason()).toBeNull()
  })

  it('is answered by a new session', () => {
    useAuth.getState().endSession('permissions-changed')
    useAuth.getState().storeTokenPair({
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN,
      expires_in: 900,
      user: principal,
    })

    expect(useAuth.getState().endReason).toBeNull()
  })

  it('is never written to a cookie', () => {
    useAuth.getState().endSession('permissions-changed')
    expect([...jar.values()].join(' ')).not.toContain('permissions-changed')
  })
})

/**
 * Rotation, and the three things a failed rotation can mean (z8pmx9md70).
 *
 * `refresh()` is mocked, so what is measured here is the store's contract: what
 * it writes, what it refuses to write, how many times it calls out, and which
 * of the three outcomes it reports. The transport's half is in http.test.ts.
 */
describe('refreshSession — rotation and its three outcomes', () => {
  const ROTATED_ACCESS = 'eyJhbGciOiJIUzI1NiJ9.rotated-payload.signature'
  const ROTATED_REFRESH = 'Rr9Tk4vB2nQ7wLz1Xc6Ym0Ps3Hd8Jf5Ae2Ou4Ig7N'

  const rotated: AuthTokenPair = {
    access_token: ROTATED_ACCESS,
    refresh_token: ROTATED_REFRESH,
    expires_in: 900,
  }

  /** A live session holding a pair, as `storeTokenPair` would have left it. */
  function signedIn(expiresAt = Date.now() + 900_000): void {
    jar.set(ACCESS, ACCESS_TOKEN)
    jar.set(REFRESH, REFRESH_TOKEN)
    useAuth.setState({
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN,
      access_token_expires_at: expiresAt,
      user: principal,
      status: 'authenticated',
      endReason: null,
      lastRefresh: null,
    })
  }

  /** The ApiError shape the interceptor rejects with. */
  function refused(status: number, code: string): ApiError {
    return { status, code, message: 'refused' }
  }

  it('replaces both halves of the pair, in the store and in the cookies (AC-14)', async () => {
    signedIn()
    vi.mocked(refresh).mockResolvedValue(rotated)

    await expect(useAuth.getState().refreshSession()).resolves.toBe('refreshed')

    expect(vi.mocked(refresh)).toHaveBeenCalledWith(REFRESH_TOKEN)
    expect(useAuth.getState().access_token).toBe(ROTATED_ACCESS)
    expect(useAuth.getState().refresh_token).toBe(ROTATED_REFRESH)
    expect(jar.get(ACCESS)).toBe(ROTATED_ACCESS)
    expect(jar.get(REFRESH)).toBe(ROTATED_REFRESH)
    // expires_in is converted exactly once, on write, and never kept as seconds.
    expect(useAuth.getState().access_token_expires_at).toBeGreaterThan(Date.now() + 890_000)
  })

  it('spends the new refresh token on the next rotation, never the old one (AC-15)', async () => {
    signedIn()
    vi.mocked(refresh).mockResolvedValue(rotated)
    await useAuth.getState().refreshSession()

    vi.mocked(refresh).mockResolvedValue({ ...rotated, access_token: 'third', refresh_token: 'r3' })
    await useAuth.getState().refreshSession()

    // The server revokes the whole family for a token presented twice, so
    // re-sending the spent one would end the session rather than renew it.
    expect(vi.mocked(refresh).mock.calls).toEqual([[REFRESH_TOKEN], [ROTATED_REFRESH]])
  })

  it('serves every concurrent caller from one request (AC-11)', async () => {
    signedIn()
    vi.mocked(refresh).mockResolvedValue(rotated)

    const outcomes = await Promise.all([
      useAuth.getState().refreshSession(),
      useAuth.getState().refreshSession(),
      useAuth.getState().refreshSession(),
    ])

    expect(outcomes).toEqual(['refreshed', 'refreshed', 'refreshed'])
    expect(vi.mocked(refresh)).toHaveBeenCalledTimes(1)
  })

  it('releases the single flight so a later rotation is a new request', async () => {
    // The defect this exists for: without the `finally`, the settled promise is
    // handed to every later caller forever — the page refreshes exactly once,
    // and every request after the next rotation replays with a dead token.
    signedIn()
    vi.mocked(refresh).mockResolvedValue(rotated)

    await useAuth.getState().refreshSession()
    await useAuth.getState().refreshSession()
    await useAuth.getState().refreshSession()

    expect(vi.mocked(refresh)).toHaveBeenCalledTimes(3)
  })

  it('releases it after an unexpected throw too', async () => {
    signedIn()
    vi.mocked(refresh).mockRejectedValueOnce(new TypeError('something unforeseen'))
    await expect(useAuth.getState().refreshSession()).resolves.toBe('deferred')

    vi.mocked(refresh).mockResolvedValue(rotated)
    await expect(useAuth.getState().refreshSession()).resolves.toBe('refreshed')

    expect(vi.mocked(refresh)).toHaveBeenCalledTimes(2)
  })

  it('clears the whole session when the server refuses the refresh token (AC-16)', async () => {
    signedIn()
    vi.mocked(refresh).mockRejectedValue(refused(401, 'AUTH_INVALID_REFRESH_TOKEN'))

    await expect(useAuth.getState().refreshSession()).resolves.toBe('ended')

    // Reuse detection has revoked the family: keeping the token would be
    // keeping a credential that is already dead, and retrying would be sending
    // a spent token a second time.
    expect(useAuth.getState().status).toBe('anonymous')
    expect(useAuth.getState().refresh_token).toBeNull()
    expect(jar.has(ACCESS)).toBe(false)
    expect(jar.has(REFRESH)).toBe(false)
    expect(vi.mocked(refresh)).toHaveBeenCalledTimes(1)
  })

  it('calls a live token refused alongside its refresh token a permissions change (AC-20)', async () => {
    // The reference documents exactly one thing that kills a token that has not
    // expired: a token_epoch bump from an administrative change — and it kills
    // the refresh token with it, which is what this pair of failures looks like.
    signedIn(Date.now() + 900_000)
    vi.mocked(refresh).mockRejectedValue(refused(401, 'AUTH_INVALID_REFRESH_TOKEN'))

    await useAuth.getState().refreshSession()

    expect(useAuth.getState().endReason).toBe('permissions-changed')
  })

  it('calls the same refusal on an expired token an expiry', async () => {
    signedIn(Date.now() - 1_000)
    vi.mocked(refresh).mockRejectedValue(refused(401, 'AUTH_INVALID_REFRESH_TOKEN'))

    await useAuth.getState().refreshSession()

    expect(useAuth.getState().endReason).toBe('expired')
  })

  it('tears nothing down for a failure that judged no token (AC-17)', async () => {
    // 429 is keyed on the TCP peer, so behind a proxy it can be another user's
    // traffic entirely; a 5xx and a dead socket say nothing either. Deciding
    // what that means for the session belongs to the caller, which knows
    // whether the access token is still alive.
    signedIn()
    vi.mocked(refresh).mockRejectedValue(refused(429, 'AUTH_RATE_LIMITED'))

    await expect(useAuth.getState().refreshSession()).resolves.toBe('deferred')

    expect(useAuth.getState().status).toBe('authenticated')
    expect(useAuth.getState().refresh_token).toBe(REFRESH_TOKEN)
    expect(jar.get(REFRESH)).toBe(REFRESH_TOKEN)
    expect(vi.mocked(refresh)).toHaveBeenCalledTimes(1)
  })

  it('reports `ended` without touching anything when there is no token to spend', async () => {
    useAuth.setState({ status: 'anonymous', refresh_token: null, endReason: 'signed-out' })

    await expect(useAuth.getState().refreshSession()).resolves.toBe('ended')

    expect(vi.mocked(refresh)).not.toHaveBeenCalled()
    // Nothing was spent, so nothing is torn down — and in particular the notice
    // a deliberate sign-out left is not overwritten with "your session expired".
    expect(useAuth.getState().endReason).toBe('signed-out')
  })
})

describe('an in-flight refresh cannot resurrect a session (TC-17)', () => {
  const rotated: AuthTokenPair = {
    access_token: 'resurrected-access',
    refresh_token: 'resurrected-refresh',
    expires_in: 900,
    user: principal,
  }

  it('drops a pair that arrives after the user signed out', async () => {
    // The hole found at review: the presented token is always spent server-side,
    // so the answer can land after the session that owned it is gone. Writing it
    // would undo a sign-out — cookies back, notice erased, status authenticated
    // again for a user who pressed Log out.
    jar.set(REFRESH, REFRESH_TOKEN)
    useAuth.setState({
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN,
      access_token_expires_at: Date.now() + 900_000,
      user: principal,
      status: 'authenticated',
      endReason: null,
      lastRefresh: null,
    })

    let land: (pair: AuthTokenPair) => void = () => {}
    vi.mocked(refresh).mockReturnValue(
      new Promise<AuthTokenPair>((resolve) => {
        land = resolve
      }),
    )

    const inFlight = useAuth.getState().refreshSession()
    useAuth.getState().signOut()
    land(rotated)

    await expect(inFlight).resolves.toBe('ended')
    expect(useAuth.getState().status).toBe('anonymous')
    expect(useAuth.getState().access_token).toBeNull()
    expect(useAuth.getState().refresh_token).toBeNull()
    expect(useAuth.getState().endReason).toBe('signed-out')
    expect(jar.has(REFRESH)).toBe(false)
  })

  it('does not clear a session that replaced the one whose refresh failed', async () => {
    useAuth.setState({
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN,
      access_token_expires_at: Date.now() + 900_000,
      user: principal,
      status: 'authenticated',
      endReason: null,
      lastRefresh: null,
    })

    let reject: (error: unknown) => void = () => {}
    vi.mocked(refresh).mockReturnValue(
      new Promise<AuthTokenPair>((_resolve, rejectPromise) => {
        reject = rejectPromise
      }),
    )

    const inFlight = useAuth.getState().refreshSession()
    // A different session now holds the store — the failure belongs to the old
    // one and must not tear this one down.
    useAuth.getState().storeTokenPair({
      access_token: 'next-access',
      refresh_token: 'next-refresh',
      expires_in: 900,
      user: principal,
    })
    reject({ status: 401, code: 'AUTH_INVALID_REFRESH_TOKEN', message: 'refused' })

    await expect(inFlight).resolves.toBe('ended')
    expect(useAuth.getState().status).toBe('authenticated')
    expect(useAuth.getState().refresh_token).toBe('next-refresh')
  })
})

describe('the refresh record is an outcome, never a value (AC-30)', () => {
  it('records a success as a verdict and a status', async () => {
    useAuth.setState({
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN,
      access_token_expires_at: Date.now() + 900_000,
      status: 'authenticated',
      lastRefresh: null,
    })
    vi.mocked(refresh).mockResolvedValue({
      access_token: 'a-secret-access-token',
      refresh_token: 'a-secret-refresh-token',
      expires_in: 900,
    })

    await useAuth.getState().refreshSession()

    const serialised = JSON.stringify(useAuth.getState().diagnostics())
    expect(useAuth.getState().lastRefresh).toMatchObject({ outcome: 'success', status: 200 })
    expect(serialised).not.toContain('a-secret-access-token')
    expect(serialised).not.toContain('a-secret-refresh-token')
  })

  it('keeps a catalogue code and drops anything else the server wrote', async () => {
    // `code` falls back to the transport's own value, and on a public route any
    // intermediary may answer — so what is recorded is checked against the
    // reference's §02 table rather than trusted.
    useAuth.setState({
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN,
      access_token_expires_at: Date.now() + 900_000,
      status: 'authenticated',
      lastRefresh: null,
    })
    vi.mocked(refresh).mockRejectedValueOnce({
      status: 429,
      code: 'AUTH_RATE_LIMITED',
      message: 'slow down',
    })
    await useAuth.getState().refreshSession()
    expect(useAuth.getState().lastRefresh).toMatchObject({
      outcome: 'failed',
      status: 429,
      code: 'AUTH_RATE_LIMITED',
    })

    vi.mocked(refresh).mockRejectedValueOnce({
      status: 502,
      code: '<img src=x onerror=alert(1)>',
      message: 'gateway says hello',
    })
    await useAuth.getState().refreshSession()
    expect(useAuth.getState().lastRefresh).toMatchObject({ outcome: 'failed', status: 502, code: null })
    expect(JSON.stringify(useAuth.getState().lastRefresh)).not.toContain('onerror')
  })
})

describe('boot recovers a session from the refresh token alone (AC-27, AC-28)', () => {
  it('spends the refresh token when the access cookie has expired, then fetches the principal', async () => {
    // The gap z8pmx9md6y left open on purpose: it dropped the dead access
    // cookie, kept the refresh token, and said recovery belonged here.
    jar.set(REFRESH, REFRESH_TOKEN)
    jar.set(ACCESS, ACCESS_TOKEN)
    jar.set(EXPIRES, String(Date.now() - 1_000))
    vi.mocked(refresh).mockResolvedValue({
      access_token: 'recovered-access',
      refresh_token: 'recovered-refresh',
      expires_in: 900,
    })
    vi.mocked(fetchMe).mockResolvedValue(principal)

    await useAuth.getState().boot()

    expect(vi.mocked(refresh)).toHaveBeenCalledWith(REFRESH_TOKEN)
    expect(useAuth.getState().status).toBe('authenticated')
    expect(useAuth.getState().access_token).toBe('recovered-access')
    expect(useAuth.getState().user).toEqual(principal)
  })

  it('recovers with no access cookie at all, given a refresh token', async () => {
    jar.set(REFRESH, REFRESH_TOKEN)
    vi.mocked(refresh).mockResolvedValue({
      access_token: 'recovered-access',
      refresh_token: 'recovered-refresh',
      expires_in: 900,
    })
    vi.mocked(fetchMe).mockResolvedValue(principal)

    await useAuth.getState().boot()

    expect(useAuth.getState().status).toBe('authenticated')
  })

  it('issues exactly one refresh and one /auth/me under StrictMode double-invocation', async () => {
    // boot()'s latch is the session state itself, so the write that closes it
    // has to happen before the first await. Putting the refresh above that
    // write would let React's second call re-enter and spend a second token —
    // and spending a refresh token twice revokes the whole family.
    jar.set(REFRESH, REFRESH_TOKEN)
    vi.mocked(refresh).mockResolvedValue({
      access_token: 'recovered-access',
      refresh_token: 'recovered-refresh',
      expires_in: 900,
    })
    vi.mocked(fetchMe).mockResolvedValue(principal)

    await Promise.all([useAuth.getState().boot(), useAuth.getState().boot()])

    expect(vi.mocked(refresh)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetchMe)).toHaveBeenCalledTimes(1)
  })

  it('lands anonymous with both cookies gone when the refresh token is rejected (AC-28)', async () => {
    jar.set(REFRESH, REFRESH_TOKEN)
    jar.set(ACCESS, ACCESS_TOKEN)
    jar.set(EXPIRES, String(Date.now() - 1_000))
    vi.mocked(refresh).mockRejectedValue({
      status: 401,
      code: 'AUTH_INVALID_REFRESH_TOKEN',
      message: 'refused',
    })

    await useAuth.getState().boot()

    expect(useAuth.getState().status).toBe('anonymous')
    expect(useAuth.getState().refresh_token).toBeNull()
    expect(jar.has(REFRESH)).toBe(false)
    expect(vi.mocked(fetchMe)).not.toHaveBeenCalled()
  })

  it('keeps the refresh token when the renewal failed for a reason that judged nothing', async () => {
    jar.set(REFRESH, REFRESH_TOKEN)
    vi.mocked(refresh).mockRejectedValue({ status: 0, code: 'NETWORK_ERROR', message: 'offline' })

    await useAuth.getState().boot()

    expect(useAuth.getState().status).toBe('anonymous')
    // Nothing here is evidence the token is dead, so the next reload tries again.
    expect(jar.get(REFRESH)).toBe(REFRESH_TOKEN)
    expect(vi.mocked(fetchMe)).not.toHaveBeenCalled()
  })

  it('attempts no refresh when there is no refresh token to spend', async () => {
    await useAuth.getState().boot()

    expect(vi.mocked(refresh)).not.toHaveBeenCalled()
    expect(useAuth.getState().status).toBe('anonymous')
  })

  it('does not spend a refresh token on a boot whose access token is still live', async () => {
    // An access token inside its lifetime that the server refuses is a
    // token_epoch bump, and the epoch invalidates the refresh token too — so a
    // refresh here buys a round-trip to reach the same answer. The access
    // cookie is dropped and the next reload takes the recovery path above.
    jar.set(ACCESS, ACCESS_TOKEN)
    jar.set(REFRESH, REFRESH_TOKEN)
    jar.set(EXPIRES, String(Date.now() + 900_000))
    vi.mocked(fetchMe).mockRejectedValue({ status: 401, code: 'AUTH_REQUIRED', message: 'no' })

    await useAuth.getState().boot()

    expect(vi.mocked(refresh)).not.toHaveBeenCalled()
    expect(useAuth.getState().status).toBe('anonymous')
    expect(useAuth.getState().endReason).toBe('permissions-changed')
    // z8pmx9md6y's decision, unchanged: the refresh token survives this.
    expect(jar.get(REFRESH)).toBe(REFRESH_TOKEN)
  })
})
