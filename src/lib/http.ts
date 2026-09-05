import axios, { type AxiosError, type AxiosInstance, type AxiosResponse } from 'axios'
import type { ResponseData } from '@/api/types'
import { toApiError } from '@/lib/api-error'
import { API_PREFIX } from '@/lib/url'
import { useAuth } from '@/stores/auth'
import { useConnection } from '@/stores/connection'
import { useDeviceStore } from '@/stores/device'

/** A URL with a scheme, or a protocol-relative one — anything axios sends without baseURL. */
const ABSOLUTE_URL = /^[a-z][a-z\d+\-.]*:|^\/\//i

/**
 * The public auth endpoints (reference §03). A 401 from one of these means "no
 * valid session", never "this origin is refused", which is the distinction the
 * connection status and its /connect screen exist to make.
 */
const AUTH_PREFIX = '/auth/'

/**
 * Every request leaves through the same relative prefix, so the backend address
 * is not something this client can know or reveal.
 */
export const http: AxiosInstance = axios.create({ baseURL: API_PREFIX, timeout: 45_000 })

http.interceptors.request.use((config) => {
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
    if (apiError.status === 401 && !path.startsWith(AUTH_PREFIX)) {
      useConnection.getState().markUnauthorized()
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
