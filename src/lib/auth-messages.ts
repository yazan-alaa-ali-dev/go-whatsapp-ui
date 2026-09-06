import type { ApiError } from '@/api/types'
import type { SessionEndReason } from '@/stores/auth'

/**
 * Every sentence the sign-in screen can say, in one file.
 *
 * The reference's error catalogue (§02) is a fixed table and the ticket's
 * acceptance criteria are that table restated, so it is mapped here as data
 * rather than as branches inside a component: this repository has no component
 * renderer, and a `switch` inside `login.tsx` would put the one part of the
 * ticket that must be provable in the one file no test can reach.
 *
 * The type import is deliberate — erased at build, so naming the session store
 * here adds no runtime edge to the import graph.
 */

export type LoginErrorKind =
  | 'credentials'
  | 'rate-limited'
  | 'not-configured'
  | 'busy'
  | 'network'
  | 'unknown'

export interface Notice {
  title: string
  description: string
}

export interface LoginError extends Notice {
  kind: LoginErrorKind
  /** Only set for `rate-limited`: how long the form stays disabled. */
  retryAfterSeconds?: number
}

/**
 * `POST /auth/login` allows 10 attempts per minute (reference §03). The window
 * is a documented constant, not a response field — the envelope carries no
 * retry hint — so the counter is advisory: it can run out while the bucket is
 * still full, in which case the next attempt simply shows the message again.
 */
export const RATE_LIMIT_WINDOW_SECONDS = 60

/**
 * A cap on text this app did not write. The `unknown` branch renders whatever
 * answered the request, and on a pre-authentication screen that could be any
 * intermediary in front of gowa. It is rendered as a text child — never as
 * HTML, never into an href — and never longer than this.
 */
export const MAX_SERVER_MESSAGE = 200

/**
 * One message for a wrong username and a wrong password alike. The backend
 * unifies the two deliberately; distinguishing them in the UI would hand back
 * the user-enumeration oracle the server just took away.
 */
const CREDENTIALS: Notice = {
  title: 'Sign-in failed',
  description:
    'That username and password were not accepted. Check both and try again — the server does not say which of the two was wrong.',
}

const RATE_LIMITED: Notice = {
  title: 'Too many sign-in attempts',
  description:
    'This server accepts a limited number of sign-in attempts per minute from one address, and everyone behind the same proxy shares that limit. Wait for the counter to finish, then try again.',
}

const NOT_CONFIGURED: Notice = {
  title: 'This server is not set up for sign-in',
  description:
    'The backend is missing the configuration it needs to issue a session, so no account can sign in here. This is a deployment problem rather than a problem with your account — whoever runs this server has to fix it.',
}

const BUSY: Notice = {
  title: 'The server is busy',
  description:
    'The server could not process the sign-in right now. Wait a few seconds and try again.',
}

const NETWORK: Notice = {
  title: 'The sign-in never reached the server',
  description:
    'The request failed before the server answered it. Check that the backend is running and that the proxy in front of this page forwards /api to it.',
}

function serverMessage(message: string): string {
  const trimmed = message.trim()
  if (!trimmed) return 'The server refused the sign-in without saying why.'
  if (trimmed.length <= MAX_SERVER_MESSAGE) return trimmed
  return `${trimmed.slice(0, MAX_SERVER_MESSAGE)}…`
}

/**
 * Map a failed sign-in onto something a human can act on.
 *
 * Code first, status second, and the order matters: `toApiError` fills `code`
 * from the envelope when there is one and falls back to `HTTP_ERROR` /
 * `NETWORK_ERROR` when there is not. A 503 from a gateway that never reached
 * gowa therefore carries no `AUTH_*` code, and must not be reported as a server
 * missing its authentication configuration.
 */
export function toLoginError(error: ApiError): LoginError {
  switch (error.code) {
    case 'AUTH_INVALID_CREDENTIALS':
      return { kind: 'credentials', ...CREDENTIALS }
    case 'AUTH_RATE_LIMITED':
      return {
        kind: 'rate-limited',
        ...RATE_LIMITED,
        retryAfterSeconds: RATE_LIMIT_WINDOW_SECONDS,
      }
    case 'AUTH_NOT_CONFIGURED':
      return { kind: 'not-configured', ...NOT_CONFIGURED }
    case 'AUTH_BUSY':
      return { kind: 'busy', ...BUSY }
    default:
      break
  }

  // No usable code. `status` 0 is the transport failing before any answer.
  if (error.status === 0) return { kind: 'network', ...NETWORK }
  if (error.status === 401) return { kind: 'credentials', ...CREDENTIALS }
  if (error.status === 429) {
    return { kind: 'rate-limited', ...RATE_LIMITED, retryAfterSeconds: RATE_LIMIT_WINDOW_SECONDS }
  }
  if (error.status === 503) return { kind: 'busy', ...BUSY }

  return { kind: 'unknown', title: 'Sign-in failed', description: serverMessage(error.message) }
}

/**
 * What the login screen says about the session that just ended.
 *
 * A deliberate sign-out gets no notice: the user pressed the button and does
 * not need to be told what they just did. The other two are distinct on purpose
 * — one is a clock running out, the other is an administrator having changed
 * the account — and both are distinct from the credentials message above.
 */
export const SIGN_OUT_NOTICES: Record<SessionEndReason, Notice | null> = {
  'signed-out': null,
  expired: {
    title: 'Your session expired',
    description: 'The session reached its time limit. Sign in again to carry on.',
  },
  'permissions-changed': {
    title: 'Your permissions were updated',
    description:
      'An administrator changed your account, which ends every session that was open at the time. Sign in again to pick up the new permissions.',
  },
}

/**
 * The two diagnoses the deleted connect screen used to carry. They are shown
 * above the form only until the server answers something — at which point it
 * has demonstrably been reached, whatever the health probe thinks.
 */
export const CONNECTION_NOTICES: Record<'unreachable' | 'unauthorized', Notice> = {
  unreachable: {
    title: "Can't reach the server",
    description:
      'The dashboard could not reach the backend through its proxy. Check that the server is running and that the proxy in front of this page forwards /api and /health to it.',
  },
  unauthorized: {
    title: 'The server refused this origin',
    description:
      'The backend answered the health check by refusing it. The server, or the proxy in front of it, has to accept requests coming from this origin.',
  },
}
