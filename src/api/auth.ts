import type { ApiError } from '@/api/types'
import { http, results } from '@/lib/http'

/**
 * The principal as the server describes it (`AuthUserView` in the reference,
 * §03). `role` is informational only — authorization reads `permissions`,
 * because roles are database rows an operator can compose without a redeploy.
 */
export interface AuthUser {
  user_id: string
  username: string
  account_id: string
  role: string
  roles: string[]
  permissions: string[]
  status: string
}

/**
 * What `POST /auth/login` and `POST /auth/refresh` return (`AuthTokenPair`).
 * `expires_in` is in **seconds** and describes the access token alone; the
 * refresh token is opaque and lives far longer. Nothing here decodes either.
 */
export interface AuthTokenPair {
  access_token: string
  refresh_token: string
  expires_in: number
  user?: AuthUser
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

/**
 * `ResponseData.results` is optional, so a 200 carrying an empty envelope would
 * otherwise rehydrate as "authenticated" with no principal — the exact opposite
 * of what /auth/me is for. Shape is checked before the value is trusted.
 */
export function isAuthUser(value: unknown): value is AuthUser {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<AuthUser>
  return (
    typeof candidate.user_id === 'string' &&
    typeof candidate.username === 'string' &&
    isStringArray(candidate.permissions)
  )
}

/**
 * The endpoint the UI is built on: the caller's principal and the final union
 * of its permissions, rebuilt server-side on every request. It is the authority
 * for `user` and `permissions[]` — no claim is read out of the access token.
 */
export async function fetchMe(): Promise<AuthUser> {
  const principal = await results<unknown>(http.get('/auth/me'))
  if (!isAuthUser(principal)) {
    const malformed: ApiError = {
      status: 0,
      code: 'MALFORMED_PRINCIPAL',
      message: 'GET /auth/me answered without a principal',
    }
    throw malformed
  }
  return principal
}
