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
    // Before this ticket a 401 could only mean "this origin is refused". With a
    // session it means the opposite: the origin is fine and the token is not.
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

  it('leaves the refresh token alone, so z8pmx9md70 still has one to use', async () => {
    respondWith(401)
    signedIn(Date.now() + 900_000)

    await expect(http.get('/devices')).rejects.toMatchObject({ status: 401 })

    expect(useAuth.getState().refresh_token).toBe('refresh-token')
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
