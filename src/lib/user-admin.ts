import type {
  AdminUser,
  CreateUserPayload,
  UpdateUserPayload,
  UserStatus,
} from '@/api/users'
import { toApiError } from '@/lib/api-error'
import type { AdminRejection } from '@/lib/auth-messages'
import { displayText } from '@/lib/surfaces'

/**
 * Every decision the users administration surface makes, as a function of its
 * arguments.
 *
 * **This repository has no component renderer in its test environment**, so a
 * decision written inside JSX is a decision no test can reach — and this is the
 * surface where a wrong decision signs a customer's operators out of every
 * device they hold, with no grace window and no way to undo it. So what to send,
 * whether anything changed at all, which rejection arrived, and whether the
 * server's own text may be shown are lifted out of the dialogs and into here,
 * where they can be asserted and mutated.
 *
 * **The three decisions this surface gets wrong most easily are all invisible
 * from the outside**, which is why each of them is a named function here:
 *
 * - *An absent field is not an empty one.* `account_id: ''` is an attempt to
 *   leave a user able to address no device, and the empty `PATCH` is a `400`
 *   rather than a no-op — because "changed nothing" and "signed someone out of
 *   everywhere" must not share a response.
 * - *`roles` replaces rather than merges*, so a partial selection silently
 *   revokes the rest.
 * - *The password limit is 72 **bytes***, which is bcrypt's own limit rather
 *   than a policy choice. A 30-character Arabic password is over it while
 *   `value.length` says 30.
 *
 * Pure: no store, no React, no axios instance, and **no query cache** — the
 * detail builders below decide from what this client submitted and from nothing
 * else, which `src/lib/source-policy.test.ts` enforces by banning the two cache
 * reads TanStack offers from this file. The same shape `@/lib/surfaces`
 * established in z8pmx9mf17, `@/lib/account-lifecycle` in z8pmx9mf18 and
 * `@/lib/account-devices` in z8pmx9mf19.
 *
 * **This module declares role ids and compares role sets. It never reads one to
 * decide anything**, which is the distinction the study (§13) draws and which
 * `source-policy.test.ts` enforces mechanically: no role value in this surface
 * may be compared against a string literal. Capability comes from
 * `permissions[]` through `@/lib/permissions`, always.
 */

/**
 * One `TextEncoder`, not one per keystroke.
 *
 * The byte counter runs on every character typed into two password fields, and
 * constructing an encoder per call is the kind of cost that is invisible until
 * it is not. Module-level because the object is stateless and reusable.
 */
const ENCODER = new TextEncoder()

/**
 * bcrypt's own limits, transcribed rather than chosen.
 *
 * 72 is where bcrypt truncates, so it is a property of the hash rather than a
 * policy this UI could relax. 8 is the server's floor.
 */
export const PASSWORD_MIN_BYTES = 8
export const PASSWORD_MAX_BYTES = 72

/** The username bounds, transcribed from the reference. */
export const USERNAME_MIN = 2
export const USERNAME_MAX = 64

/**
 * The cap applied to every operator-controlled string this surface renders.
 *
 * Shorter than a username may legitimately be (64), which is deliberate: the cap
 * is about what fits a table cell and a confirmation sentence, not about what is
 * valid. `displayText` appends an ellipsis, so a truncated value reads as
 * truncated rather than as a different value.
 */
export const MAX_DISPLAY = 60

/**
 * The three role ids the backend seeds.
 *
 * **Offered, not enumerated.** There is no endpoint that lists the available
 * roles (study §14, `Q-2`) — roles are database rows an operator can compose
 * without a redeploy — so this is a convenience for the three that certainly
 * exist, beside a free-text field for anything else. An unknown id answers
 * `404`, which is the authority; this list is not.
 *
 * Nothing reads it to decide anything. It is the *options in a checkbox group*,
 * and `source-policy.test.ts` fails the build if any role value in this surface
 * is compared against a literal.
 */
export const SEEDED_ROLES: readonly string[] = Object.freeze(['user', 'admin', 'super_admin'])

/**
 * The page size the UI asks for, and the ceiling the server enforces.
 *
 * **`MAX_PAGE_SIZE` is a clamp and nothing else — there is no size selector.**
 * `GET /auth/users` caps at 500, but 500 rows with a four-action row set is
 * several thousand DOM nodes and there is no windowing anywhere in this stack;
 * adding a virtualiser would inline it into a single-file bundle for a page size
 * nobody asked for. 100 is what this surface requests, always.
 */
export const DEFAULT_PAGE_SIZE = 100
export const MAX_PAGE_SIZE = 500

/**
 * The sentence a failed password request gets, in place of the server's own.
 *
 * See `passwordFailure`. The text names no value and never will.
 */
export const PASSWORD_FAILED_REDACTED =
  'The request was refused. The server’s reason is not shown here because this request carried a password, and a rejection can quote the field it rejected. Check the password against the rule below and try again.'

/**
 * The password's length **in bytes**, which is the only length that matters.
 *
 * The study calls this out as an error that will certainly happen in an Arabic
 * deployment if it is not written: `'كلمة مرور طويلة جدا'.length` is 19 while
 * its UTF-8 encoding is 35 bytes, and the same arithmetic puts a 30-character
 * Arabic password over a 72-byte limit that a character count says is barely
 * half used.
 *
 * `TextEncoder` is an *encode*, and is not what `source-policy.test.ts` bans:
 * that rule forbids `TextDecoder`, `atob` and friends because they are how a JWT
 * gets taken apart. Nothing is decoded here.
 */
export function passwordByteLength(value: string): number {
  return ENCODER.encode(value).length
}

/**
 * Why this password cannot be sent, or `null` when it can.
 *
 * **The message states the byte length rather than only the rule**, because the
 * whole failure mode is a password that looks the right length and is not: an
 * operator told "too long" about a 30-character string has no way to see why.
 * It quotes the count, never the value.
 */
export function passwordError(value: string): string | null {
  if (value === '') return null
  const bytes = passwordByteLength(value)
  if (bytes < PASSWORD_MIN_BYTES) {
    return `A password must be at least ${PASSWORD_MIN_BYTES} bytes. This one is ${bytes}.`
  }
  if (bytes > PASSWORD_MAX_BYTES) {
    return `A password may be at most ${PASSWORD_MAX_BYTES} bytes — the limit belongs to the hash, not to this deployment. This one is ${bytes} bytes, which is why a password that looks short enough can still be refused: characters outside the latin alphabet take two to four bytes each.`
  }
  return null
}

/**
 * The username as it will actually be stored.
 *
 * Called on every change rather than on submit, so the field lower-cases as it
 * is typed. The alternative — normalising silently at submission — makes the
 * server look as though it altered the input, which is the specific confusion
 * the study asks the form to prevent.
 */
export function normaliseUsername(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * Why this username cannot be sent, or `null` when it can.
 *
 * 2–64 characters, first character a letter or a digit, `@` admitted so an email
 * address can be a login name.
 *
 * **Deliberately permissive after the first character**, the same reasoning
 * `metaTokenRefError` records one module over: being stricter than the server
 * rejects input the server would have taken, and the server is the authority.
 *
 * **This is not a bidi guard and must not be read as one.** A username carrying
 * `U+202E` passes here, is accepted by the server, and is neutralised at every
 * render site by `displayText` — which is the right layer for it, because the
 * hazard is in the rendering rather than in the value.
 */
export function usernameError(value: string): string | null {
  const username = normaliseUsername(value)
  if (username === '') return null
  if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
    return `A username is ${USERNAME_MIN} to ${USERNAME_MAX} characters. This one is ${username.length}.`
  }
  if (!/^[a-z0-9]/.test(username)) {
    return 'A username starts with a letter or a digit.'
  }
  return null
}

/** Why this email cannot be sent, or `null`. Optional, so blank is not an error. */
export function emailError(value: string): string | null {
  const email = value.trim()
  if (email === '') return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return 'That does not look like an email address. Leave it empty if this user has none.'
  }
  return null
}

/** Which account arm of the create form is selected. */
export type AccountArm = 'existing' | 'new'

export interface CreateUserFields {
  username: string
  password: string
  email: string
  roles: readonly string[]
  status: UserStatus
  arm: AccountArm
  /** The `existing` arm. */
  accountId: string
  /** The `new` arm. */
  newAccountId: string
  newAccountName: string
}

/**
 * The create body, or `null` when the account arm has not resolved.
 *
 * **`null` is what makes "both or neither" unable to produce a request at all.**
 * `CreateUserPayload` is already a union that will not compile with both keys
 * (z8pmx9mf16) — this is the runtime half of the same guarantee, for the state
 * the type cannot see: an arm selected but not filled in. A user with a blank
 * account can address no device, so that request is never built rather than
 * built and refused.
 *
 * **`email` and `roles` are omitted when empty, not blanked.** An omitted
 * `roles` is precisely how the server's own least-privileged default is
 * obtained; sending `[]` would ask for a user holding no role at all, which is a
 * different request. `clean()` from `@/api/request` is not used, for the reason
 * `src/api/users.ts` states in its header: it drops `''` as well, which on these
 * endpoints collapses two different instructions into one.
 */
export function createUserPayloadFrom(fields: CreateUserFields): CreateUserPayload | null {
  const username = normaliseUsername(fields.username)
  const email = fields.email.trim()
  const roles = fields.roles.filter((role) => role.trim() !== '')

  const base = {
    username,
    password: fields.password,
    status: fields.status,
    ...(email === '' ? {} : { email }),
    ...(roles.length === 0 ? {} : { roles: [...roles] }),
  }

  if (fields.arm === 'existing') {
    const accountId = fields.accountId.trim()
    return accountId === '' ? null : { ...base, account_id: accountId }
  }

  const accountId = fields.newAccountId.trim()
  const name = fields.newAccountName.trim()
  if (accountId === '' || name === '') return null
  return { ...base, account: { account_id: accountId, name } }
}

/** The mutable half of a user, as the edit form holds it. */
export interface EditableUser {
  email: string
  accountId: string
  status: UserStatus
  roles: readonly string[]
}

/** The row, as the form seeds itself from it. */
export function editableFrom(user: AdminUser): EditableUser {
  return {
    email: user.email,
    accountId: user.account_id,
    status: user.status,
    roles: [...user.roles].sort(),
  }
}

/** Do these two role sets name the same roles? Order is not a difference. */
function sameRoles(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const left = [...a].sort()
  const right = [...b].sort()
  return left.every((role, index) => role === right[index])
}

/**
 * The partial change, built from the dirty fields alone.
 *
 * **An absent field is not written, and that is the whole of this function.**
 * The server treats every field as a pointer, so sending one it did not need is
 * not harmless padding — it is a write. Sending `account_id: ''` in particular
 * is an attempt to leave the user able to address nothing, and is refused.
 *
 * `account_id` is therefore emitted only when it is **non-empty and different**.
 * There is no path through this function that produces an empty one, which is
 * stronger than validating for it: the shape cannot be built.
 *
 * `roles` is compared as a **set** — a reordering is not a change — and emitted
 * **complete** when it differs, because the endpoint replaces rather than merges.
 * A delta would silently revoke everything it omitted.
 *
 * `email` may legitimately be emptied: it is "unique when non-blank; several
 * users may have none", so `''` is a real instruction here and is forwarded as
 * one. That asymmetry with `account_id` is the reason this is a hand-written
 * comparison rather than a generic differ.
 */
export function updatePayloadFrom(original: EditableUser, edited: EditableUser): UpdateUserPayload {
  const payload: UpdateUserPayload = {}

  const email = edited.email.trim()
  if (email !== original.email) payload.email = email

  const accountId = edited.accountId.trim()
  if (accountId !== '' && accountId !== original.accountId) payload.account_id = accountId

  if (edited.status !== original.status) payload.status = edited.status

  const roles = edited.roles.filter((role) => role.trim() !== '')
  if (!sameRoles(roles, original.roles)) payload.roles = [...roles]

  return payload
}

/**
 * Is there nothing to send?
 *
 * This is what the save button is disabled on. The endpoint answers an empty
 * body with `400` rather than treating it as a no-op — deliberately, because
 * every non-empty `PATCH` signs the user out of everything — so the client's job
 * is to never produce one, not to explain one after the fact.
 */
export function isEmptyUpdate(payload: UpdateUserPayload): boolean {
  return Object.keys(payload).length === 0
}

/**
 * Could this change remove somebody's ability to administer users?
 *
 * Disabling an account and rewriting its role set are the two ways to do it
 * through `PATCH`, and both are what the server's last-administrator guard
 * answers `409` to. It is used to pick between the two meanings a `409` can
 * carry on this endpoint — see `userRejection`.
 */
export function mayRemoveAdministration(payload: UpdateUserPayload): boolean {
  return payload.status === 'disabled' || payload.roles !== undefined
}

/** Which request produced the failure. The caller always knows; a classifier would guess. */
export type UserOperation = 'create' | 'update' | 'delete' | 'reset'

export interface RejectionContext {
  /** Is the target of this request the signed-in principal? */
  targetIsSelf: boolean
  /** Could this request have collided with an existing username, email or account id? */
  mayCollide: boolean
  /** Could this request have removed somebody's ability to administer users? */
  mayRemoveAdmin: boolean
}

/**
 * Which entry of `ADMIN_REJECTIONS` this failure is, or `null` for none.
 *
 * **The caller picks the entry, and this is that caller's classifier.**
 * `auth-messages.ts` states at length why the table carries none of its own: a
 * function guessing from a status code would be choosing between two `403`s and
 * two `409`s it cannot tell apart, while a caller that knows which request it
 * just made can. `deviceRejection` in `@/lib/account-devices` is the same shape,
 * one surface over.
 *
 * The two ambiguous statuses, resolved by what the request *was* rather than by
 * what came back:
 *
 * - **`403`** is self-mutation only when you are the target *and* the request
 *   was a delete or a disable — changing your own roles is allowed, because it
 *   can only narrow. Everything else is privilege escalation. In practice this
 *   arm rarely fires: the surface hides both actions on your own row. It is the
 *   honest mapping anyway, because hiding is an affordance and the server is the
 *   authority.
 * - **`409`** is last-administrator when the request could have removed
 *   administration, and a collision otherwise. When *both* are possible — an
 *   edit that changes an email and disables the account in one payload — this
 *   returns `last-administrator`, the consequential one, and **the caller
 *   appends `collisionDetail` anyway**, so both readings are on screen. The
 *   client does not pick between two causes the server deliberately refused to
 *   distinguish.
 *
 * `503` is the bcrypt queue, and reaches only the two operations that carry a
 * password. An unrecognised status returns `null` and the caller falls through —
 * to `toActionErrorMessage` where no password was sent, and to
 * `PASSWORD_FAILED_REDACTED` where one was.
 */
export function userRejection(
  error: unknown,
  operation: UserOperation,
  context: RejectionContext,
): AdminRejection | null {
  const { status } = toApiError(error)

  if (status === 403) {
    const destructiveToSelf =
      context.targetIsSelf && (operation === 'delete' || context.mayRemoveAdmin)
    return destructiveToSelf ? 'self-mutation' : 'privilege-escalation'
  }
  if (status === 409) {
    return context.mayRemoveAdmin || operation === 'delete' ? 'last-administrator' : 'already-taken'
  }
  if (status === 404) return 'not-found'
  if (status === 503 && (operation === 'create' || operation === 'reset')) {
    return 'password-hashing-busy'
  }
  return null
}

/**
 * May the server's own text be rendered for this failure?
 *
 * **`toActionErrorMessage` prints `apiError.message` verbatim for any non-403**,
 * so a `400` from `POST /auth/users` or `POST /auth/users/{id}/password` that
 * quotes the value it rejected would print a credential inside the dialog that
 * is still holding it. That is not hypothetical: a validation error naming the
 * offending field is the ordinary shape of a `400`.
 *
 * This is the third instance of a shape this repository has already committed to
 * twice — `createFailure` / `CREATE_FAILED_REDACTED` for `meta_token_ref`, and
 * `webhookSaveFailure` / `WEBHOOK_SAVE_FAILED_REDACTED` for the webhook signing
 * secret. Both are enforced by source rules, and so is this one: neither
 * password-carrying dialog may call `toActionErrorMessage` at all.
 *
 * A failure with no server behind it — `status: 0`, meaning offline, DNS, or a
 * cancelled request — keeps its text. There is no response to have echoed
 * anything, and discarding the only diagnostic available would make an
 * unreachable server indistinguishable from a rejected password.
 */
export function passwordFailure(error: unknown): 'server' | 'redacted' {
  return toApiError(error).status >= 400 ? 'redacted' : 'server'
}

/** What this client put on the wire. The detail builders read this and nothing else. */
export interface SubmittedIdentity {
  username?: string
  email?: string
  accountId?: string
  userId?: string
  roles?: readonly string[]
}

function quoted(values: string[]): string {
  return values.join(', ')
}

/**
 * Which of the values *this client sent* could have collided.
 *
 * **The argument is the submitted payload and there is nothing else in scope.**
 * The server answers a single `409` for "the username, the email, **or** the
 * inline account id is already taken" and does not say which — deliberately,
 * because saying would hand back the user-enumeration oracle the sign-in screen
 * already gives up. `auth-messages.ts` refuses to split that, and this does not
 * split it either: it repeats what the operator typed a second ago, which adds
 * no bits to what they already know, and states plainly that the server did not
 * say which one.
 *
 * The temptation this function exists to foreclose is a "helpful" scan of the
 * loaded page for a matching username. That would both split what the server
 * joined *and* be wrong, because the page is one page of an endpoint with no
 * total and no account filter — an absent match means "not on this page", never
 * "available". `source-policy.test.ts` bans the two cache reads from this file
 * so the shortcut is not available to write.
 *
 * Every value is sanitised before it is interpolated: these are operator-typed
 * strings heading into a rendered sentence.
 */
export function collisionDetail(submitted: SubmittedIdentity): string {
  const values: string[] = []
  if (submitted.username) values.push(`username “${displayText(submitted.username, MAX_DISPLAY)}”`)
  if (submitted.email) values.push(`email “${displayText(submitted.email, MAX_DISPLAY)}”`)
  if (submitted.accountId) {
    values.push(`account id “${displayText(submitted.accountId, MAX_DISPLAY)}”`)
  }
  if (values.length === 0) return ''
  return `This request sent ${quoted(values)}. The server does not say which of them collided, so change what you can and try again.`
}

/**
 * What *this request addressed*, for a `404`.
 *
 * Same discipline as `collisionDetail`: it names what was sent, never what
 * exists. The `404` covers "no such user, account **or** role", and an account
 * belonging to another tenant answers it byte for byte identically — so the
 * sentence stays non-committal between "gone" and "not yours", exactly as the
 * `not-found` notice does.
 *
 * The role id is the reason this is worth building at all. There is no endpoint
 * listing roles, so the free-text field is how an operator names one — and a
 * bare `404` after typing one is unreadable, while "this request named role
 * `billing`" is the whole diagnosis.
 */
export function notFoundDetail(submitted: SubmittedIdentity): string {
  const values: string[] = []
  if (submitted.userId) values.push(`user “${displayText(submitted.userId, MAX_DISPLAY)}”`)
  if (submitted.accountId) {
    values.push(`account “${displayText(submitted.accountId, MAX_DISPLAY)}”`)
  }
  const roles = submitted.roles?.filter((role) => role.trim() !== '') ?? []
  for (const role of roles) values.push(`role “${displayText(role, MAX_DISPLAY)}”`)
  if (values.length === 0) return ''
  return `This request named ${quoted(values)}. The server answers the same way for something that does not exist and something that is not yours to address, so check each one.`
}

/**
 * Is this row the signed-in principal?
 *
 * On `user_id` alone. A username is not an identity — it is mutable
 * operator-chosen text, and this surface renders a sanitised copy of it — so
 * comparing names here would make a homoglyph decide whether the delete button
 * appears.
 */
export function isSelf(userId: string, signedInUserId: string | null | undefined): boolean {
  return !!signedInUserId && userId === signedInUserId
}

/**
 * The loaded page, narrowed to one account.
 *
 * **Within the page, and the screen has to say so.** `GET /auth/users` takes no
 * `account_id` (study §14, `Q-3`), so this is the honest shape rather than a
 * limitation to hide: a filter that looks authoritative over an endpoint that
 * cannot be filtered would report "this account has two users" when it has
 * forty, thirty-eight of them on the next page.
 *
 * An absent filter returns the array unchanged — the same reference, so a
 * memoised caller does not re-render for a filter nobody set.
 */
export function filterByAccount(
  users: readonly AdminUser[] | undefined,
  accountId: string | undefined,
): readonly AdminUser[] {
  if (!users) return []
  if (!accountId) return users
  return users.filter((user) => user.account_id === accountId)
}

export interface PageState {
  canNext: boolean
  canPrevious: boolean
  nextOffset: number
  previousOffset: number
}

/**
 * Where the pager can go from here.
 *
 * **Next/previous, because the response carries no total.** The array is flat —
 * there is no count to build a numbered pager from — so "was this page full"
 * is the only signal available, and a full last page offers a "next" that lands
 * on nothing. That is the documented cost of the shape and is preferable to a
 * page count this client would have to invent.
 *
 * It returns four fields rather than five: `full` is the input `canNext` is
 * derived from, and exposing both invites a caller to branch on the wrong one.
 *
 * `previousOffset` never goes below zero.
 */
export function pageState(rowCount: number, limit: number, offset: number): PageState {
  return {
    canNext: rowCount >= limit,
    canPrevious: offset > 0,
    nextOffset: offset + limit,
    previousOffset: Math.max(0, offset - limit),
  }
}
