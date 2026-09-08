import type { ApiError } from '@/api/types'
import { toApiError } from '@/lib/api-error'
import type { SessionEndReason } from '@/stores/auth'

/**
 * Every sentence this app says about who you are and what you may do, in one
 * file — the sign-in screen's copy, the notice about a session that ended, the
 * two connection diagnoses, and the one sentence a 403 gets.
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
  'credentials' | 'rate-limited' | 'not-configured' | 'busy' | 'network' | 'unknown'

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

/**
 * Cap text this app did not write, and say what to do when there is none.
 *
 * The empty case is the caller's because the two callers are on different
 * screens: a sign-in that failed says one thing, a rejected action says
 * another, and a 403 whose body said nothing wants no trailing detail at all.
 */
function serverMessage(message: string, whenEmpty: string): string {
  const trimmed = message.trim()
  if (!trimmed) return whenEmpty
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

  return {
    kind: 'unknown',
    title: 'Sign-in failed',
    description: serverMessage(error.message, 'The server refused the sign-in without saying why.'),
  }
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

/**
 * What a 403 says. The reference's §02 table describes the row as
 * "authenticated, but without sufficient permission — better to hide the button
 * in the first place", which is what `<Can>` is for; this is what the user sees
 * when the button could not be hidden, or when the server disagrees with what
 * the UI believed.
 */
export const PERMISSION_DENIED: Notice = {
  title: "You don't have permission for this action",
  description:
    'Your account is signed in, but it is not allowed to do this. An administrator can grant the permission; nothing is wrong with your session.',
}

/** What a failed action says when the server explained nothing. */
const NO_SERVER_DETAIL = 'The request failed and the server did not say why.'

/**
 * The message a failed action shows.
 *
 * **A 403 is a permission rejection, not an identity one.** It is not a
 * malfunction, it is not a session ending, and — provably, in
 * `src/lib/http.ts` and its tests — it spends no refresh and triggers no
 * logout. So it gets a sentence that says so instead of whatever the server
 * wrote, which on this route is usually a bare "forbidden".
 *
 * **But the server's text is kept, not replaced.** A 403 is not necessarily
 * gowa's: a WAF, a reverse proxy or an origin refusal answers 403 too, and
 * reporting that as an account-permission problem while discarding the only
 * diagnostic anyone has would make the real cause unfindable. §02 gives the 403
 * row **no error code** — its code column is literally `—` — so unlike
 * `toLoginError`, which distinguishes an `AUTH_*` code from a gateway's 503,
 * there is nothing here to key on. Keeping the text is what remains, and it is
 * enough: the sentence orients the user, the detail tells an operator whether
 * the request ever reached gowa.
 *
 * Both arms are capped at `MAX_SERVER_MESSAGE`. Any intermediary in front of
 * gowa can choose that text, and this module already caps it for the login
 * screen; a toast is no different.
 */
export function toActionErrorMessage(error: unknown): string {
  const apiError = toApiError(error)
  if (apiError.status !== 403) return serverMessage(apiError.message, NO_SERVER_DETAIL)
  const detail = serverMessage(apiError.message, '')
  return detail ? `${PERMISSION_DENIED.title}. ${detail}` : PERMISSION_DENIED.title
}

/**
 * The phase-2 administrative rejections, next to `PERMISSION_DENIED` above.
 *
 * **The table says what the wire says, and no more.** Five of these have no
 * error code anywhere in the reference, and two of the three that are named —
 * `ACCOUNT_HAS_DEVICES` and `ACCOUNT_DEVICE_COUNT_MISMATCH` — appear only in
 * prose descriptions of a 409, never inside a rendered envelope, so even those
 * are inferred rather than transcribed. Inventing code strings for the rest
 * would produce branches that never fire, which is the failure mode the typed
 * `PERMISSIONS` catalogue exists to prevent one module over.
 *
 * **And the table does not split what the server joins.** `POST /auth/users`
 * answers a single 409 for "the username, the email, **or** the inline account
 * id is already taken", and a single 404 for "no such user, account **or**
 * role". Reporting which of the three collided would hand back a
 * user-enumeration oracle the backend deliberately withheld — the same oracle
 * `AUTH_INVALID_CREDENTIALS` gives up on the sign-in screen, and which the
 * `CREDENTIALS` notice above already refuses to reconstruct. `PATCH
 * …/sms-fallback` documents its 404 as byte-identical for an account belonging
 * to another tenant, for the same reason. So no notice below names a field, and
 * none asserts that anything does not exist.
 *
 * There is no classifier here on purpose. Nothing in this ticket calls one, and
 * a caller that knows which request it just made is better placed to pick an
 * entry than a function guessing from a status code. `toActionErrorMessage`
 * above remains the generic path, unchanged.
 */
export type AdminRejection =
  | 'account-has-devices'
  | 'account-device-count-mismatch'
  | 'account-id-taken'
  | 'already-taken'
  | 'not-found'
  | 'privilege-escalation'
  | 'self-mutation'
  | 'last-administrator'
  | 'password-hashing-busy'
  | 'device-not-available'
  | 'device-id-taken'
  | 'device-belongs-elsewhere'
  | 'account-not-found'
  | 'device-order-refused'

export const ADMIN_REJECTIONS: Record<AdminRejection, Notice> = {
  // 409 ACCOUNT_HAS_DEVICES (code inferred from the reference's prose).
  'account-has-devices': {
    title: 'This account still has devices',
    description:
      'Nothing was deleted. Deleting an account that owns devices destroys their WhatsApp session keys, so it is never done as a side effect — ask for it explicitly, or detach or delete the devices first.',
  },
  // 409 ACCOUNT_DEVICE_COUNT_MISMATCH (code inferred the same way).
  'account-device-count-mismatch': {
    title: 'The device count did not match',
    description:
      'Nothing was purged and nothing was deleted. The number of devices changed between reading the account and confirming the deletion. Reopen the account, check what it owns now, and confirm again.',
  },
  // 409 from POST /accounts (z8pmx9mf18). Separate from 'already-taken' below
  // rather than folded into it, because the two endpoints answer differently
  // and the difference is the whole reason that entry is worded the way it is:
  // POST /auth/users joins three causes into one 409 and must not be split,
  // while POST /accounts documents exactly one — "an account with this id
  // already exists" — over an id the operator chose a second ago, so naming it
  // hands back nothing they did not already type.
  'account-id-taken': {
    title: 'An account with this id already exists',
    description:
      'Nothing was created and nothing was overwritten — this is a create, not an upsert, so the existing account and its stored token reference are untouched. Choose a different id, or leave the field empty to have one generated.',
  },
  'already-taken': {
    title: 'That name is already in use',
    description:
      'The username, the email address or the account id you entered belongs to something that already exists. The server does not say which of the three, so change what you can and try again.',
  },
  'not-found': {
    title: 'Not found',
    description:
      'What you named either does not exist or is not available to your account — the server answers the same way for both, on purpose. Check the id, and check that it belongs to an account you may address.',
  },
  'privilege-escalation': {
    title: 'That change is above your own permissions',
    description:
      'You cannot grant a permission you do not hold yourself, and you cannot change or delete a user who holds one. Someone with the wider permission has to make this change.',
  },
  'self-mutation': {
    title: 'You cannot do this to your own account',
    description:
      'Deleting or disabling the account you are signed in with is refused, so a deployment cannot be locked out by one click. Ask another administrator to do it.',
  },
  'last-administrator': {
    title: 'This is the last administrator',
    description:
      'At least one active user must be able to administer users, so this one cannot be deleted, disabled, or stripped of that permission. There is no way to recover from that state through the API. Give another user the permission first.',
  },
  // 404 on any device endpoint (z8pmx9mf19). The one notice on this table that
  // exists to say LESS than the caller knows: a device belonging to another
  // account answers 404 with a body identical to a device that does not exist,
  // "because doing so would confirm the device's existence to a caller who may
  // not address it" (reference §06). So this never says "you do not have
  // permission for this device" — the backend deliberately refuses to tell the
  // two apart, and repeating a guess here would hand back the oracle it withheld.
  'device-not-available': {
    title: 'That device is not available',
    description:
      'The id you submitted names no device you can address — either it does not exist, or it belongs to another account. The server answers the same way for both, on purpose, so there is nothing more to know from here. Check the id.',
  },
  // 409 from POST /accounts/{id}/devices/create.
  'device-id-taken': {
    title: 'That device id is already taken',
    description:
      'Nothing was created and the existing device was not taken over. Choose a different id, or leave the field empty to have one generated. If the device you meant already exists, attach it instead of creating it.',
  },
  // 409 from POST /accounts/{id}/devices — the attach path.
  'device-belongs-elsewhere': {
    title: 'That device belongs to another account',
    description:
      'Nothing was attached. A device belongs to one account and there is no endpoint that moves it, so it cannot be taken from where it is. Attaching it to the account it already belongs to would have been accepted and changed nothing.',
  },
  // 404 from POST /accounts/{id}/devices/create — this one is about the ACCOUNT,
  // not the device, which is why it is a separate entry from 'not-found'.
  'account-not-found': {
    title: 'That account no longer exists',
    description:
      'Nothing was created. The account was there when this screen loaded and is not there now — it may have been deleted from another session. Go back to the accounts list and reload it.',
  },
  // 400 from PUT /accounts/{id}/devices/order.
  'device-order-refused': {
    title: 'The new order was refused',
    description:
      'Nothing was written and the order is unchanged. This endpoint rewrites the order from the complete list, so it refuses one that omits a device of the account, repeats one, or names a device of another account — which means what this screen was holding no longer matches the server. The list has been read again; try the move once more.',
  },
  // 503 AUTH_BUSY — the same bcrypt queue the sign-in path meets, one surface over.
  'password-hashing-busy': {
    title: 'The server is busy',
    description:
      'The server could not hash the password right now because its queue is full. Nothing was changed. Wait a few seconds and try again.',
  },
}
