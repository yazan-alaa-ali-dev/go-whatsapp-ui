import axios, { type AxiosError, type AxiosInstance, type AxiosResponse } from 'axios'
import type { ResponseData } from '@/api/types'
import { toApiError } from '@/lib/api-error'
import { API_PREFIX } from '@/lib/url'
import { useAuth } from '@/stores/auth'
import { useDeviceStore } from '@/stores/device'

declare module 'axios' {
  interface AxiosRequestConfig {
    /**
     * Set once, immediately before a 401 on this request is answered with a
     * refresh. It is what makes "exactly one attempt per request" true: the
     * replay carries it, so a second 401 spends no second refresh and the
     * session is torn down instead of looping.
     */
    sessionRetry?: boolean
  }
}

/** A URL with a scheme, or a protocol-relative one — anything axios sends without baseURL. */
const ABSOLUTE_URL = /^[a-z][a-z\d+\-.]*:|^\/\//i

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

/**
 * The reactive half of the session's lifetime (z8pmx9md70).
 *
 * A 401 no longer means "this origin is refused" — since z8pmx9md6z it means
 * the origin is fine and the token is not. The reference's instruction for that
 * is exact: **one** refresh attempt, and if it does not work, a full logout. A
 * client that keeps a session it cannot renew is the half-working state this
 * layer exists to remove.
 *
 * The four guards below are in this order for a reason, and each one is
 * load-bearing.
 */
http.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error: unknown) => {
    const apiError = toApiError(error)
    const config = (error as AxiosError).config
    const path = config?.url ?? ''

    if (apiError.status !== 401 || !config) return Promise.reject(apiError)

    // 1. No live session, nothing to recover. This is the no-op that absorbs
    //    the burst of refetch 401s a cache teardown produces before the guard
    //    unmounts the tree — and, since a refresh now happens here, the guard
    //    that stops a deliberate sign-out being reported to the user as "Your
    //    session expired": signOut() has already set the reason and dropped the
    //    refresh token, and a refresh attempt on its way out would overwrite
    //    both. It is also why TanStack's `retry: 1` cannot produce a second
    //    wave of refreshes: the first failure made the session anonymous.
    if (useAuth.getState().status !== 'authenticated') return Promise.reject(apiError)

    // 2. The public auth routes judge a body, not a session. A 401 from
    //    /auth/login is a wrong password, and a 401 from /auth/refresh is the
    //    refresh itself failing — answering that with another refresh is the
    //    infinite loop. /auth/me is deliberately NOT on that list: a 401 there
    //    is a refused session and is exactly what should be recovered.
    if (isPublicAuthPath(path)) return Promise.reject(apiError)

    // 3. This request already spent its one attempt, so the token it is now
    //    being refused with is one the server minted moments ago. That is what
    //    a token_epoch bump looks like, and there is nothing left to try.
    if (config.sessionRetry) {
      useAuth.getState().endRefusedSession()
      return Promise.reject(apiError)
    }

    // 4. One attempt. Concurrent 401s all land on the same in-flight promise.
    config.sessionRetry = true
    const outcome = await useAuth.getState().refreshSession()

    if (outcome === 'refreshed') {
      // Assignment rather than `delete`: the request interceptor only attaches
      // a bearer when there is not one already, so the replay would otherwise
      // carry the token that was just refused — and deleting would also discard
      // a header a caller set deliberately, case-sensitively at that.
      config.headers = config.headers ?? {}
      config.headers.Authorization = `Bearer ${useAuth.getState().access_token}`
      return http.request(config)
    }

    // `ended` means the store has already torn the session down, with the
    // reason it inferred. `deferred` means nothing was judged — a 429 from a
    // bucket keyed on the TCP peer, a 5xx — so the reason is stated rather than
    // inferred: telling this user an administrator changed their account
    // because somebody else filled a shared bucket would be a lie.
    if (outcome === 'deferred') useAuth.getState().endRefusedSession('expired')
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
