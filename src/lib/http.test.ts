import {
  AxiosError,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useAuth } from '@/stores/auth'
import { useConnection } from '@/stores/connection'
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
  })
  useConnection.setState({ status: 'connected' })
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

describe('what a 401 means', () => {
  it('marks the connection unauthorized when a guarded endpoint refuses', async () => {
    respondWith(401)

    await expect(http.get('/devices')).rejects.toMatchObject({ status: 401 })

    expect(useConnection.getState().status).toBe('unauthorized')
  })

  /**
   * The /auth/* endpoints are public (reference §03): a 401 from one of them
   * says "no valid session", never "this origin is refused" — which is what the
   * connection status and its /connect screen exist to say. Without this, the
   * landing screen after a reload depended on which of two promises won.
   */
  it('leaves the connection alone when an auth endpoint says there is no session', async () => {
    respondWith(401)

    await expect(http.get('/auth/me')).rejects.toMatchObject({ status: 401 })

    expect(useConnection.getState().status).toBe('connected')
  })
})
