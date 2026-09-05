import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchMe, type AuthUser } from '@/api/auth'
import { useAuth } from './auth'

vi.mock('@/api/auth', () => ({ fetchMe: vi.fn() }))

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
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.mocked(fetchMe).mockReset()
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
