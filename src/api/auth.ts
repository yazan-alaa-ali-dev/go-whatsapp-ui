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

/** What the login form sends, and the only shape `POST /auth/login` accepts. */
export interface LoginCredentials {
  username: string
  password: string
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
 * The same argument as `isAuthUser`, one endpoint over: `ResponseData.results`
 * is optional, so a 200 carrying an empty envelope would otherwise be stored as
 * a session made of `undefined` — a signed-in state with no credential in it.
 * `user` is not required here because the reference marks it optional on the
 * pair; when it is missing the store falls back to `GET /auth/me`.
 */
export function isAuthTokenPair(value: unknown): value is AuthTokenPair {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<AuthTokenPair>
  return (
    typeof candidate.access_token === 'string' &&
    candidate.access_token.length > 0 &&
    typeof candidate.refresh_token === 'string' &&
    candidate.refresh_token.length > 0 &&
    typeof candidate.expires_in === 'number' &&
    Number.isFinite(candidate.expires_in)
  )
}

/**
 * The only place a session is created. Public and body-only (reference §03), so
 * `src/lib/http.ts` deliberately sends it no `Authorization` header and no
 * `X-Device-Id`: a stale token in a cookie must not be able to change the
 * outcome of a sign-in.
 */
export async function login(credentials: LoginCredentials): Promise<AuthTokenPair> {
  const pair = await results<unknown>(http.post('/auth/login', credentials))
  if (!isAuthTokenPair(pair)) {
    const malformed: ApiError = {
      status: 0,
      code: 'MALFORMED_TOKEN_PAIR',
      message: 'POST /auth/login answered without a token pair',
    }
    throw malformed
  }
  return pair
}

/**
 * Revokes the whole refresh-token family. Public and body-only on purpose — it
 * reads no principal — so a session whose access token has already died can
 * still revoke a refresh token with 30 days left on it.
 *
 * There is no return value to unwrap: the reference notes `results` is omitted
 * for this route entirely.
 */
export async function logout(refresh_token: string): Promise<void> {
  await http.post('/auth/logout', { refresh_token })
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
