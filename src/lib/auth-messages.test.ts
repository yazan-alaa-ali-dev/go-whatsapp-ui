import { describe, expect, it } from 'vitest'
import type { ApiError } from '@/api/types'
import {
  ADMIN_REJECTIONS,
  type AdminRejection,
  CONNECTION_NOTICES,
  MAX_SERVER_MESSAGE,
  PERMISSION_DENIED,
  RATE_LIMIT_WINDOW_SECONDS,
  SIGN_OUT_NOTICES,
  toActionErrorMessage,
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

describe('what a rejected action says (AC-19, TC-10)', () => {
  it('reports a 403 as a permission rejection, not a malfunction', () => {
    const message = toActionErrorMessage(apiError(403, 'HTTP_ERROR', 'forbidden'))

    expect(message).toContain(PERMISSION_DENIED.title)
    expect(message).toMatch(/permission/i)
  })

  it('keeps the server’s own text alongside the sentence', () => {
    // A 403 is not necessarily gowa's — a WAF, a reverse proxy or an origin
    // refusal answers 403 too, and §02 gives the 403 row NO error code (its
    // code column is literally `—`), so there is nothing to key on. Keeping the
    // detail is what tells an operator the request never reached gowa.
    const message = toActionErrorMessage(
      apiError(403, 'HTTP_ERROR', 'Request blocked by security policy 42'),
    )

    expect(message).toContain(PERMISSION_DENIED.title)
    expect(message).toContain('Request blocked by security policy 42')
  })

  it('says only the sentence when the server explained nothing', () => {
    expect(toActionErrorMessage(apiError(403, 'HTTP_ERROR', '   '))).toBe(PERMISSION_DENIED.title)
  })

  it('leaves every other failure reporting what the server said', () => {
    expect(toActionErrorMessage(apiError(404, 'DEVICE_NOT_FOUND', 'device not found'))).toBe(
      'device not found',
    )
    expect(toActionErrorMessage(apiError(500, 'HTTP_ERROR', 'boom'))).toBe('boom')
  })

  it('says something useful when a non-403 failure carried no message either', () => {
    const message = toActionErrorMessage(apiError(500, 'HTTP_ERROR', ''))
    expect(message).not.toBe('')
    expect(message).toMatch(/did not say why/i)
  })

  it('caps server-chosen text on both arms', () => {
    // Any intermediary in front of gowa chooses this string; the login screen
    // already caps it, and a toast is no different.
    const long = 'x'.repeat(MAX_SERVER_MESSAGE + 200)

    const forbidden = toActionErrorMessage(apiError(403, 'HTTP_ERROR', long))
    const other = toActionErrorMessage(apiError(500, 'HTTP_ERROR', long))

    expect(forbidden).toContain('…')
    expect(forbidden.length).toBeLessThan(long.length)
    expect(other).toBe(`${'x'.repeat(MAX_SERVER_MESSAGE)}…`)
  })

  it('does not describe a 403 as a session problem', () => {
    // The distinction the whole criterion rests on: a 403 is a permission
    // rejection, not an identity one. Telling the user to sign in again would
    // be wrong, and would send them to a screen that fixes nothing.
    const message = toActionErrorMessage(apiError(403, 'HTTP_ERROR', 'forbidden'))

    expect(message).not.toMatch(/sign in|log in|expired|session/i)
    expect(PERMISSION_DENIED.description).toMatch(/nothing is wrong with your session/i)
  })

  it('normalises anything thrown, not only an ApiError', () => {
    expect(toActionErrorMessage(new Error('plain failure'))).toBe('plain failure')
  })
})

describe('the phase-2 rejections (AC-27, AC-28, TC-15)', () => {
  const KEYS: AdminRejection[] = [
    'account-has-devices',
    'account-device-count-mismatch',
    'already-taken',
    'not-found',
    'privilege-escalation',
    'self-mutation',
    'last-administrator',
    'password-hashing-busy',
  ]

  it('covers every rejection the ticket lists, and nothing else', () => {
    expect(Object.keys(ADMIN_REJECTIONS).sort()).toEqual([...KEYS].sort())
  })

  it('sits beside the existing permission-denied entry rather than replacing it', () => {
    expect(PERMISSION_DENIED.title).toBeTruthy()
    expect(Object.values(ADMIN_REJECTIONS)).not.toContain(PERMISSION_DENIED)
  })

  it('says what happened and what to do next, in every entry', () => {
    for (const key of KEYS) {
      const notice = ADMIN_REJECTIONS[key]
      expect(notice.title.length, key).toBeGreaterThan(0)
      // Long enough to carry a consequence and a next step; short enough that
      // nobody has pasted a server string in.
      expect(notice.description.length, key).toBeGreaterThan(60)
      expect(notice.description.length, key).toBeLessThan(400)
      expect(notice.description.trim().endsWith('.'), key).toBe(true)
    }
  })

  it('carries no markup, so nothing here can be rendered as HTML', () => {
    for (const key of KEYS) {
      expect(ADMIN_REJECTIONS[key].title, key).not.toMatch(/[<>]/)
      expect(ADMIN_REJECTIONS[key].description, key).not.toMatch(/[<>]/)
    }
  })

  it('never names which of the three joined causes collided', () => {
    // The specification documents ONE 409 for "the username, the email, or the
    // inline account id is already taken". Reporting which one would reinstate
    // a user-enumeration oracle the backend deliberately withheld — the same
    // one AUTH_INVALID_CREDENTIALS gives up on the sign-in screen, and which
    // the CREDENTIALS notice above already refuses to reconstruct.
    const taken = ADMIN_REJECTIONS['already-taken'].description
    expect(taken).toMatch(/username/)
    expect(taken).toMatch(/email/)
    expect(taken).toMatch(/account id/)
    expect(taken).toMatch(/does not say which/)
  })

  it('never asserts that something does not exist', () => {
    // The 404 covers "no such user, account OR role", and an account belonging
    // to another tenant answers the same 404 byte for byte. So the notice must
    // stay non-committal between "gone" and "not yours".
    const notFound = ADMIN_REJECTIONS['not-found'].description
    expect(notFound).toMatch(/not available to your account/)
    expect(notFound).toMatch(/the same way for both/)
  })

  it('is a table and not a classifier — nothing here consumes an error', () => {
    // Two of the eight have a name on the wire and both are INFERRED from prose
    // descriptions of a 409 rather than read out of a rendered envelope. A
    // caller that knows which request it just made picks an entry; a function
    // guessing from a status code would be picking between 403s and between
    // 409s it cannot tell apart. That belongs to the ticket with the callers.
    for (const notice of Object.values(ADMIN_REJECTIONS)) {
      expect(typeof notice).toBe('object')
      expect(typeof notice.title).toBe('string')
    }
    expect(toActionErrorMessage({ status: 403, code: '', message: '' })).toBe(
      PERMISSION_DENIED.title,
    )
  })
})
