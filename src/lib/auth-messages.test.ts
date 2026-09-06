import { describe, expect, it } from 'vitest'
import type { ApiError } from '@/api/types'
import {
  CONNECTION_NOTICES,
  MAX_SERVER_MESSAGE,
  RATE_LIMIT_WINDOW_SECONDS,
  SIGN_OUT_NOTICES,
  toLoginError,
} from './auth-messages'

/**
 * The error catalogue is the half of the login screen that can be proved. This
 * repository has no component renderer, so the mapping lives outside the page
 * precisely so these assertions can exist.
 */

function apiError(status: number, code: string, message = 'server said so'): ApiError {
  return { status, code, message }
}

describe('the error catalogue (reference §02)', () => {
  it('maps invalid credentials to one unified message (AC-10)', () => {
    const error = toLoginError(apiError(401, 'AUTH_INVALID_CREDENTIALS'))
    expect(error.kind).toBe('credentials')
    // The backend unifies the two causes deliberately; the UI must not undo it.
    expect(`${error.title} ${error.description}`.toLowerCase()).not.toMatch(
      /unknown user|no such user|user not found|wrong password|incorrect password/,
    )
  })

  it('maps a rate limit to a wait, and never to an automatic retry (AC-11)', () => {
    const error = toLoginError(apiError(429, 'AUTH_RATE_LIMITED'))
    expect(error.kind).toBe('rate-limited')
    expect(error.retryAfterSeconds).toBe(RATE_LIMIT_WINDOW_SECONDS)
  })

  it('does not blame this user for the rate limit (AC-15)', () => {
    // The limiter keys on the TCP peer, so behind a reverse proxy the bucket is
    // shared: "you tried too many times" is wrong more often than it is right.
    const { description } = toLoginError(apiError(429, 'AUTH_RATE_LIMITED'))
    expect(description).toMatch(/shar|address/i)
  })

  it('maps a server with no auth configuration to a deployment fault (AC-12)', () => {
    const error = toLoginError(apiError(503, 'AUTH_NOT_CONFIGURED'))
    expect(error.kind).toBe('not-configured')
    expect(error.description).toMatch(/deployment|whoever runs this server/i)
    // Never tell an anonymous visitor which secret the deployment is missing —
    // that is a statement that authentication is not enforced here.
    expect(`${error.title} ${error.description}`).not.toMatch(/AUTH_JWT_SECRET/)
  })

  it('maps a busy bcrypt queue to a transient failure (AC-13)', () => {
    const error = toLoginError(apiError(503, 'AUTH_BUSY'))
    expect(error.kind).toBe('busy')
    expect(error.retryAfterSeconds).toBeUndefined()
  })

  it('maps a transport failure to a connection error, not an auth error (AC-14)', () => {
    const error = toLoginError(apiError(0, 'NETWORK_ERROR', 'Network Error'))
    expect(error.kind).toBe('network')
  })

  it('reads the code before the status, so a gateway 503 is not a misconfigured server', () => {
    // A 503 that never reached gowa carries no AUTH_* code. Reporting it as
    // AUTH_NOT_CONFIGURED would accuse the deployment of something it is not
    // doing, on the word of a proxy.
    const error = toLoginError(apiError(503, 'HTTP_ERROR', 'Service Unavailable'))
    expect(error.kind).toBe('busy')
    expect(error.description).not.toMatch(/configuration/i)
  })

  it('falls back to the status when the envelope carried no code', () => {
    expect(toLoginError(apiError(401, 'HTTP_ERROR')).kind).toBe('credentials')
    expect(toLoginError(apiError(429, 'HTTP_ERROR')).kind).toBe('rate-limited')
  })

  it('caps text this app did not write', () => {
    // The login screen is pre-authentication, so any intermediary in front of
    // gowa can choose this string. It is rendered as a text child, and capped.
    const long = 'x'.repeat(MAX_SERVER_MESSAGE * 3)
    const error = toLoginError(apiError(418, 'ODD', long))
    expect(error.kind).toBe('unknown')
    expect(error.description.length).toBeLessThanOrEqual(MAX_SERVER_MESSAGE + 1)
  })

  it('says something rather than nothing when the server sent an empty message', () => {
    expect(toLoginError(apiError(418, 'ODD', '   ')).description.trim()).not.toBe('')
  })
})

describe('the sign-out notices (AC-22, AC-23)', () => {
  it('says nothing when the user signed out on purpose', () => {
    expect(SIGN_OUT_NOTICES['signed-out']).toBeNull()
  })

  it('names an administrative change for a token-epoch bump (AC-22)', () => {
    const notice = SIGN_OUT_NOTICES['permissions-changed']
    expect(notice?.title).toMatch(/permission/i)
    expect(notice?.description).toMatch(/administrator/i)
  })

  it('keeps the three messages a user can be shown distinct (AC-23)', () => {
    // A copy-paste regression guard, not proof: what makes these three
    // *meaningfully* distinct is read by a human, and verify.md records that.
    const messages = [
      SIGN_OUT_NOTICES.expired,
      SIGN_OUT_NOTICES['permissions-changed'],
      toLoginError(apiError(401, 'AUTH_INVALID_CREDENTIALS')),
    ].map((notice) => `${notice?.title}|${notice?.description}`)

    expect(new Set(messages).size).toBe(messages.length)
  })
})

describe('the connection notices inherited from the deleted connect screen', () => {
  it('tells a failed probe apart from a refused origin', () => {
    expect(CONNECTION_NOTICES.unreachable.title).not.toBe(CONNECTION_NOTICES.unauthorized.title)
    expect(CONNECTION_NOTICES.unreachable.description).toMatch(/proxy/i)
  })
})
