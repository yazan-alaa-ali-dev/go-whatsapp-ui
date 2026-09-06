import axios, { type AxiosError, type AxiosInstance, type AxiosResponse } from 'axios'
import type { ResponseData } from '@/api/types'
import { toApiError } from '@/lib/api-error'
import { API_PREFIX } from '@/lib/url'
import { useAuth } from '@/stores/auth'
import { useDeviceStore } from '@/stores/device'

/** A URL with a scheme, or a protocol-relative one — anything axios sends without baseURL. */
const ABSOLUTE_URL = /^[a-z][a-z\d+\-.]*:|^\/\//i

/**
 * The public auth endpoints (reference §03). A 401 from one of these means "no
 * valid session" — a sign-in that was refused, say — and never "a session just
 * ended", so it must not tear one down.
 */
const AUTH_PREFIX = '/auth/'

/**
 * The three public, body-only auth routes (reference §03). They read no
 * principal and no device, so they are sent neither credential.
 *
 * For `/auth/login` that is the ticket's requirement rather than a tidiness
 * preference: a sign-in has to work while the browser is carrying a stale or
 * corrupt token, and the way to guarantee that is not to send it. The device id
 * goes for the same reason — it belongs to whichever session selected it, and a
 * public endpoint has no use for one.
 *
 * `/auth/me` is not on this list. It is the one auth route that needs a bearer.
 */
const PUBLIC_AUTH_PATHS = ['/auth/login', '/auth/refresh', '/auth/logout']

function isPublicAuthPath(url: string): boolean {
  return PUBLIC_AUTH_PATHS.some((path) => url.startsWith(path))
}

/**
 * Every request leaves through the same relative prefix, so the backend address
 * is not something this client can know or reveal.
 */
export const http: AxiosInstance = axios.create({ baseURL: API_PREFIX, timeout: 45_000 })

http.interceptors.request.use((config) => {
  // Checked before either store is read, so a public auth request costs nothing
  // and — more to the point — cannot pick up a credential on its way out.
  if (isPublicAuthPath(config.url ?? '')) return config

  const deviceId = useDeviceStore.getState().selectedDeviceId
  if (deviceId && !config.headers['X-Device-Id']) {
    config.headers['X-Device-Id'] = encodeURIComponent(deviceId)
  }
  // The auth store is the only source of the token (z8pmx9md6y). The
  // same-origin check is not ceremony: axios ignores baseURL for an absolute
  // URL, and this backend hands out absolute qr_link/file_path values built
  // from its own Host header — sending the credential to one would be a leak.
  const token = useAuth.getState().access_token
  if (token && !config.headers.Authorization && !ABSOLUTE_URL.test(config.url ?? '')) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

http.interceptors.response.use(
  (response: AxiosResponse) => response,
  (error: unknown) => {
    const apiError = toApiError(error)
    const path = (error as AxiosError).config?.url ?? ''
    // Before z8pmx9md6z a 401 could only mean "this origin is refused", because
    // there was no session to refuse — it downgraded the connection status and
    // the connect screen said so. Now that a session exists it means the
    // opposite: the origin is fine and the token is not, so the session ends.
    //
    // A 401 from /auth/* still says nothing about a session (those routes are
    // public, and a rejected sign-in is not a session ending), and the teardown
    // is a no-op when no session is held — which is what keeps a token-epoch
    // bump, refusing every in-flight request at once, to one teardown.
    if (apiError.status === 401 && !path.startsWith(AUTH_PREFIX)) {
      useAuth.getState().endRefusedSession()
    }
    return Promise.reject(apiError)
  },
)

/** Unwrap the gowa envelope {code, message, results}. */
export async function results<T>(request: Promise<AxiosResponse<ResponseData<T>>>): Promise<T> {
  const response = await request
  return response.data.results as T
}

export async function envelope<T>(
  request: Promise<AxiosResponse<ResponseData<T>>>,
): Promise<ResponseData<T>> {
  const response = await request
  return response.data
}
