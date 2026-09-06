import {
  AxiosError,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useAuth } from '@/stores/auth'
import { useDeviceStore } from '@/stores/device'
import { http } from './http'

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.header-payload.signature'

/** Every request is answered here, so the real interceptor chain runs offline. */
function respondWith(status: number): { sent: InternalAxiosRequestConfig[] } {
  const sent: InternalAxiosRequestConfig[] = []
  const adapter: AxiosAdapter = async (config) => {
    sent.push(config as InternalAxiosRequestConfig)
    const response = {
      status,
      data: { code: 'SUCCESS', message: '', results: null },
      statusText: '',
      headers: {},
      config,
    } as AxiosResponse
    if (status >= 400) {
      throw new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, undefined, response)
    }
    return response
  }
  http.defaults.adapter = adapter
  return { sent }
}

const originalAdapter = http.defaults.adapter

beforeEach(() => {
  useAuth.setState({
    access_token: null,
    refresh_token: null,
    access_token_expires_at: null,
    user: null,
    status: 'unknown',
    endReason: null,
  })
  useDeviceStore.setState({ selectedDeviceId: null })
})

afterEach(() => {
  http.defaults.adapter = originalAdapter
})

describe('the bearer header', () => {
  it('comes from the auth store, and from nowhere else', async () => {
    const { sent } = respondWith(200)
    useAuth.setState({ access_token: TOKEN })

    await http.get('/app/info')

    expect(sent[0].headers.Authorization).toBe(`Bearer ${TOKEN}`)
  })

  it('is absent when no session is held', async () => {
    const { sent } = respondWith(200)

    await http.get('/app/info')

    expect(sent[0].headers.Authorization).toBeUndefined()
  })

  /**
   * axios ignores baseURL for an absolute URL, and this backend hands out
   * absolute qr_link / file_path values built from its own Host header. Sending
   * the credential to one of those would be a leak to whatever host it named.
   */
  it('is not attached to an absolute URL, whoever supplied it', async () => {
    const { sent } = respondWith(200)
    useAuth.setState({ access_token: TOKEN })

    await http.get('https://elsewhere.example.com/steal')
    await http.get('//elsewhere.example.com/steal')

    expect(sent[0].headers.Authorization).toBeUndefined()
    expect(sent[1].headers.Authorization).toBeUndefined()
  })

  it('does not overwrite a header the caller set deliberately', async () => {
    const { sent } = respondWith(200)
    useAuth.setState({ access_token: TOKEN })

    await http.get('/app/info', { headers: { Authorization: 'Bearer caller-supplied' } })

    expect(sent[0].headers.Authorization).toBe('Bearer caller-supplied')
  })
})

describe('the public auth routes carry no credential (AC-4, TC-9)', () => {
  /**
   * `/auth/login`, `/auth/refresh` and `/auth/logout` are public and read their
   * body only (reference §03). A sign-in has to work while the browser is
   * carrying a stale or corrupt token, and the way to guarantee that is not to
   * send it — the reference says the server tolerates one, but tolerance is not
   * a thing to depend on.
   */
  it('sends no Authorization header to any of them', async () => {
    const { sent } = respondWith(200)
    useAuth.setState({ access_token: TOKEN })

    await http.post('/auth/login', { username: 'admin', password: 'x' })
    await http.post('/auth/refresh', { refresh_token: 'r' })
    await http.post('/auth/logout', { refresh_token: 'r' })

    for (const request of sent) expect(request.headers.Authorization).toBeUndefined()
  })

  it('sends no device id either — it belongs to a session, not to a public route', async () => {
    const { sent } = respondWith(200)
    useDeviceStore.setState({ selectedDeviceId: 'device-1' })

    await http.post('/auth/login', { username: 'admin', password: 'x' })

    expect(sent[0].headers['X-Device-Id']).toBeUndefined()
  })

  it('still sends the bearer to /auth/me, the one auth route that needs it', async () => {
    const { sent } = respondWith(200)
    useAuth.setState({ access_token: TOKEN })
    useDeviceStore.setState({ selectedDeviceId: 'device-1' })

    await http.get('/auth/me')

    expect(sent[0].headers.Authorization).toBe(`Bearer ${TOKEN}`)
    expect(sent[0].headers['X-Device-Id']).toBe('device-1')
  })
})

describe('what a 401 means now that a session can exist', () => {
  /** A session the store would call live: authenticated, token not yet expired. */
  function signedIn(expiresAt: number): void {
    useAuth.setState({
      access_token: TOKEN,
      refresh_token: 'refresh-token',
      access_token_expires_at: expiresAt,
      user: null,
      status: 'authenticated',
      endReason: null,
    })
  }

  it('ends the session when a guarded endpoint refuses a live token (TC-7)', async () => {
    // Before z8pmx9md6z a 401 could only mean "this origin is refused". With a
    // session it means the opposite: the origin is fine and the token is not.
    // Since z8pmx9md70 the route to this outcome is longer — one refresh is
    // attempted first, and this adapter refuses that too — but the outcome and
    // the reason it records are unchanged, which is the point of asserting it.
    respondWith(401)
    signedIn(Date.now() + 900_000)

    await expect(http.get('/devices')).rejects.toMatchObject({ status: 401 })

    expect(useAuth.getState().status).toBe('anonymous')
    expect(useAuth.getState().endReason).toBe('permissions-changed')
  })

  it('calls an already-expired token an expiry, not an administrative change', async () => {
    respondWith(401)
    signedIn(Date.now() - 1_000)

    await expect(http.get('/devices')).rejects.toMatchObject({ status: 401 })

    expect(useAuth.getState().endReason).toBe('expired')
  })

  /**
   * **This assertion inverted in z8pmx9md70, deliberately.** It used to read
   * "leaves the refresh token alone, so z8pmx9md70 still has one to use" — true
   * while nothing spent it. Now a 401 on a guarded route spends one refresh,
   * and this adapter answers everything 401, `POST /auth/refresh` included. A
   * refresh refused with 401 is the server judging the token: reuse detection
   * has revoked the family, so keeping it would be keeping a dead credential.
   */
  it('clears the refresh token once the server has refused it too (AC-16)', async () => {
    const { sent } = respondWith(401)
    signedIn(Date.now() + 900_000)

    await expect(http.get('/devices')).rejects.toMatchObject({ status: 401 })

    expect(useAuth.getState().refresh_token).toBeNull()
    expect(sent.filter((request) => request.url === '/auth/refresh')).toHaveLength(1)
  })

  it('changes nothing when no session was held', async () => {
    // A 401 without a session is not a session ending — it is an
    // unauthenticated request. This no-op is also what keeps a burst of refetch
    // 401s harmless while the guard is still unmounting the protected tree.
    respondWith(401)

    await expect(http.get('/devices')).rejects.toMatchObject({ status: 401 })

    expect(useAuth.getState().status).toBe('unknown')
    expect(useAuth.getState().endReason).toBeNull()
  })

  /**
   * The /auth/* endpoints are public (reference §03): a 401 from one of them
   * says "these credentials are no good", never "the session you had just
   * ended". A refused sign-in must not tear down a session.
   */
  it('leaves the session alone when an auth endpoint answers 401', async () => {
    respondWith(401)
    signedIn(Date.now() + 900_000)

    await expect(http.post('/auth/login', { username: 'a', password: 'b' })).rejects.toMatchObject({
      status: 401,
    })

    expect(useAuth.getState().status).toBe('authenticated')
    expect(useAuth.getState().endReason).toBeNull()
  })
})

/**
 * The reactive half of the session's lifetime (z8pmx9md70).
 *
 * These run against a routing adapter rather than the blanket one above,
 * because every property worth asserting here is about *which* request got
 * which answer: the refresh has to be counted separately from the request that
 * provoked it, and the replay has to be distinguishable from the first attempt.
 */
describe('a 401 spends exactly one refresh (AC-9, AC-10, AC-11)', () => {
  const ROTATED_ACCESS = 'eyJhbGciOiJIUzI1NiJ9.rotated-payload.signature'
  const ROTATED_REFRESH = 'Rr9Tk4vB2nQ7wLz1Xc6Ym0Ps3Hd8Jf5Ae2Ou4Ig7N'

  /**
   * What one request looked like **at the moment it left**.
   *
   * A snapshot rather than the config itself, and that is not tidiness: the
   * replay is `http.request(config)` on the config that already failed, so the
   * first attempt and the replay share a headers object. Keeping references
   * would show the first attempt carrying the token that only exists because it
   * was refused — the assertion would read backwards and prove nothing.
   */
  interface SentRequest {
    url: string
    authorization: string | undefined
    body: unknown
  }

  /** Answers each request by URL, and records every one that was sent. */
  function respondBy(
    handler: (config: InternalAxiosRequestConfig) => { status: number; data?: unknown },
  ): { sent: SentRequest[] } {
    const sent: SentRequest[] = []
    const adapter: AxiosAdapter = async (config) => {
      sent.push({
        url: config.url ?? '',
        authorization: config.headers?.Authorization as string | undefined,
        body: config.data,
      })
      const { status, data } = handler(config as InternalAxiosRequestConfig)
      const response = {
        status,
        data: data ?? {
          code: status === 200 ? 'SUCCESS' : 'HTTP_ERROR',
          message: '',
          results: null,
        },
        statusText: '',
        headers: {},
        config,
      } as AxiosResponse
      if (status >= 400) {
        throw new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, undefined, response)
      }
      return response
    }
    http.defaults.adapter = adapter
    return { sent }
  }

  /** A rotated pair, in the envelope POST /auth/refresh answers with. */
  function rotatedPair(): { status: number; data: unknown } {
    return {
      status: 200,
      data: {
        code: 'SUCCESS',
        message: 'Rotated',
        results: {
          access_token: ROTATED_ACCESS,
          refresh_token: ROTATED_REFRESH,
          expires_in: 900,
        },
      },
    }
  }

  function signedIn(): void {
    useAuth.setState({
      access_token: TOKEN,
      refresh_token: 'refresh-token',
      access_token_expires_at: Date.now() + 900_000,
      user: null,
      status: 'authenticated',
      endReason: null,
      lastRefresh: null,
    })
  }

  const urlsOf = (sent: SentRequest[]): string[] => sent.map((request) => request.url)
  const countOf = (sent: SentRequest[], url: string): number =>
    urlsOf(sent).filter((sentUrl) => sentUrl === url).length

  it('replays the request with the NEW token, not the one that was refused', async () => {
    // The load-bearing half of this is the token, not the replay: the request
    // interceptor only attaches a bearer when there is not one already, so a
    // replay that reused the original config would carry the token the server
    // had just refused — and an assertion that merely counted attempts would
    // pass anyway.
    const { sent } = respondBy((config) => {
      if (config.url === '/auth/refresh') return rotatedPair()
      return { status: config.sessionRetry ? 200 : 401 }
    })
    signedIn()

    await http.get('/devices')

    expect(urlsOf(sent)).toEqual(['/devices', '/auth/refresh', '/devices'])
    expect(sent[0].authorization).toBe(`Bearer ${TOKEN}`)
    expect(sent[2].authorization).toBe(`Bearer ${ROTATED_ACCESS}`)
    expect(useAuth.getState().status).toBe('authenticated')
  })

  it('rotates both halves of the pair together (AC-14, AC-15)', async () => {
    const { sent } = respondBy((config) => {
      if (config.url === '/auth/refresh') return rotatedPair()
      return { status: config.sessionRetry ? 200 : 401 }
    })
    signedIn()

    await http.get('/devices')

    expect(useAuth.getState().access_token).toBe(ROTATED_ACCESS)
    expect(useAuth.getState().refresh_token).toBe(ROTATED_REFRESH)
    // The token that was spent is never sent again — the server revokes the
    // whole family for a token presented twice.
    expect(sent[1].body).toBe(JSON.stringify({ refresh_token: 'refresh-token' }))
  })

  it('ends the session rather than looping when the replay is refused too (AC-13, TC-18)', async () => {
    // Found at review: a route that still 401s after a *successful* refresh
    // would otherwise leave the session authenticated, holding a credential the
    // server refuses — the guard never redirects and the dashboard sits there
    // 401ing. Counting attempts alone would not have caught it.
    const { sent } = respondBy((config) =>
      config.url === '/auth/refresh' ? rotatedPair() : { status: 401 },
    )
    signedIn()

    await expect(http.get('/devices')).rejects.toMatchObject({ status: 401 })

    expect(countOf(sent, '/devices')).toBe(2)
    expect(countOf(sent, '/auth/refresh')).toBe(1)
    expect(useAuth.getState().status).toBe('anonymous')
  })

  it('serves five concurrent 401s from one refresh (AC-11, TC-5)', async () => {
    const { sent } = respondBy((config) => {
      if (config.url === '/auth/refresh') return rotatedPair()
      return { status: config.sessionRetry ? 200 : 401 }
    })
    signedIn()

    const replies = await Promise.all([
      http.get('/chats'),
      http.get('/devices'),
      http.get('/groups'),
      http.get('/app/info'),
      http.get('/messages'),
    ])

    expect(replies).toHaveLength(5)
    expect(countOf(sent, '/auth/refresh')).toBe(1)
    // Five first attempts, one refresh, five replays.
    expect(sent).toHaveLength(11)
  })

  it('attempts no refresh for a 401 on a public auth route (AC-12, TC-6)', async () => {
    const { sent } = respondBy(() => ({ status: 401 }))
    signedIn()

    await expect(http.post('/auth/login', { username: 'a', password: 'b' })).rejects.toMatchObject({
      status: 401,
    })
    await expect(http.post('/auth/refresh', { refresh_token: 'r' })).rejects.toMatchObject({
      status: 401,
    })

    // Two requests, both the ones that were asked for. A refresh answering a
    // 401 from /auth/refresh is the infinite loop this guard exists to prevent.
    expect(urlsOf(sent)).toEqual(['/auth/login', '/auth/refresh'])
    expect(useAuth.getState().status).toBe('authenticated')
  })

  it('does not retry a refresh the rate limiter refused, nor blame permissions (AC-17)', async () => {
    // A 429 is keyed on the TCP peer, so behind a proxy it can be somebody
    // else's traffic. It ends the session — the reference allows one attempt,
    // then a logout — but the reason must not accuse an administrator of
    // changing this user's account, which the inferred reason would have done
    // while the access token was still inside its lifetime.
    const { sent } = respondBy((config) =>
      config.url === '/auth/refresh'
        ? { status: 429, data: { code: 'AUTH_RATE_LIMITED', message: 'slow down' } }
        : { status: 401 },
    )
    signedIn()

    await expect(http.get('/devices')).rejects.toMatchObject({ status: 401 })

    expect(countOf(sent, '/auth/refresh')).toBe(1)
    expect(useAuth.getState().status).toBe('anonymous')
    expect(useAuth.getState().endReason).toBe('expired')
    // 429 is not a verdict on the token, so the refresh token is kept.
    expect(useAuth.getState().refresh_token).toBe('refresh-token')
  })

  it('records the attempt as an outcome, never as a value (AC-30)', async () => {
    respondBy((config) =>
      config.url === '/auth/refresh' ? rotatedPair() : { status: config.sessionRetry ? 200 : 401 },
    )
    signedIn()

    await http.get('/devices')

    const record = useAuth.getState().diagnostics().lastRefresh
    expect(record).toMatchObject({ outcome: 'success', status: 200, code: null })
    expect(JSON.stringify(record)).not.toContain(ROTATED_ACCESS)
    expect(JSON.stringify(record)).not.toContain(ROTATED_REFRESH)
  })

  it('attempts nothing once the session is already gone (TC-17)', async () => {
    // The no-op that absorbs the burst of refetch 401s a cache teardown
    // produces — and the guard that stops a deliberate sign-out being reported
    // back to the user as "Your session expired".
    const { sent } = respondBy(() => ({ status: 401 }))
    useAuth.setState({
      access_token: null,
      refresh_token: null,
      access_token_expires_at: null,
      user: null,
      status: 'anonymous',
      endReason: 'signed-out',
      lastRefresh: null,
    })

    await expect(http.get('/devices')).rejects.toMatchObject({ status: 401 })

    expect(urlsOf(sent)).toEqual(['/devices'])
    expect(useAuth.getState().endReason).toBe('signed-out')
  })

  it('does not spend the kept refresh token on a 401 that arrives after the session ended', async () => {
    // The case above cannot fail without this one, and mutation-testing the
    // live-session gate is what showed it: there the refresh token was already
    // null, so removing the gate changed nothing and the guard looked untested.
    //
    // The *involuntary* teardown is different, and it is the one that matters:
    // `endSession` keeps the refresh token on purpose. A request still in the
    // air when the session ended would otherwise spend that token, and a pair
    // carrying `user` would put the status back to `authenticated` — a session
    // the store had just declared over, resurrected by a straggler.
    const { sent } = respondBy((config) =>
      config.url === '/auth/refresh' ? { ...rotatedPair(), status: 200 } : { status: 401 },
    )
    signedIn()
    useAuth.getState().endSession('expired')
    expect(useAuth.getState().refresh_token).toBe('refresh-token')

    await expect(http.get('/devices')).rejects.toMatchObject({ status: 401 })

    expect(urlsOf(sent)).toEqual(['/devices'])
    expect(useAuth.getState().status).toBe('anonymous')
    expect(useAuth.getState().refresh_token).toBe('refresh-token')
    expect(useAuth.getState().endReason).toBe('expired')
  })
})
