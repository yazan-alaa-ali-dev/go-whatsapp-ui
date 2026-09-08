import { http, results } from '@/lib/http'

/**
 * The six user-administration endpoints under `/auth/users`, all of which
 * require `users.manage` and each of which carries an additional privilege-ceiling
 * check on the server.
 *
 * **This module declares a role and does nothing else with one.** The field name
 * is on the wire, so it cannot be avoided; deriving anything from it is what the
 * reference's golden rule forbids and what `@/lib/permissions` exists to
 * replace. `src/lib/source-policy.test.ts` enforces the difference mechanically
 * rather than by review: every mention of the field in this file must be one of
 * its declarations, so a read, a rename, a lookup table or a bracket access
 * fails the build. Hiding a control is an affordance, never enforcement; the
 * server is the only authority.
 *
 * **`clean()` is not used here either.** See `omitUntouched` below: on this
 * endpoint an absent field and an empty one are different instructions, and a
 * helper that drops empties would collapse them.
 */

const enc = encodeURIComponent

export type UserStatus = 'active' | 'disabled'

/**
 * One identity as the administration API returns it.
 *
 * **There is no `permissions` field and that is deliberate.** The effective
 * union of a user's grants is what `GET /auth/me` answers, and duplicating it
 * here would be a second implementation of the same join. So a users table
 * cannot show "this user's permissions" — there is no source for it — and the
 * most it may show is the role ids assigned.
 *
 * **There is no password hash and there never will be.** The field does not
 * exist on the server type at all, so this is true by construction rather than
 * by a serialisation tag one careless edit from deletion.
 */
export interface AdminUser {
  user_id: string
  /** Stored lower-cased, so `Admin` and `admin` are one account. */
  username: string
  email: string
  /**
   * Never blank for a user created through this API. The empty string is the
   * sentinel meaning **no account**, and it resolves to an empty device set —
   * not to every un-accounted device.
   */
  account_id: string
  status: UserStatus
  /** The role ids held, sorted. Displayed and assigned; never read for a decision. */
  roles: string[]
  /**
   * Returned so an operator can *see* that a change invalidated the outstanding
   * tokens rather than having to trust that it did. Every mutating call
   * increments it, and every access and refresh token the user holds is refused
   * on its next request — there is no grace window.
   */
  token_epoch: number
  created_at: string
  updated_at: string
}

/** A new account defined inline, in the same request that creates its first user. */
export interface NewAccountSpec {
  account_id: string
  name: string
}

interface CreateUserBase {
  /** 2–64 characters, starting with a letter or digit; `@` is admitted. Stored lower-cased. */
  username: string
  /**
   * 8–72 **bytes**, not characters — 72 is bcrypt's own limit rather than a
   * policy choice. A 30-character Arabic password is over the limit while
   * `value.length` says 30, so a form validating this must measure the encoded
   * length. Hashed before the transaction opens; never stored, logged or echoed.
   */
  password: string
  /** Optional. Unique when non-blank; several users may have none. */
  email?: string
  /**
   * Defaults to the least privileged option when omitted, because an omitted
   * field must never widen access. A caller may not grant what they do not hold.
   */
  roles?: string[]
  /** Defaults to active. Creating a user disabled is legitimate. */
  status?: UserStatus
}

/**
 * Create a user, and optionally its account, in one atomic call.
 *
 * **`account_id` and `account` are alternatives and exactly one is required.**
 * Both together is a conflict; neither is refused outright. The reason is
 * stated: a user with a blank account can address no device at all, so that
 * state is refused rather than created and there is no window in which it
 * exists — which also makes "create a new customer" one operation rather than
 * two, since both rows commit or neither does.
 *
 * The union models that so the one shape the server always rejects does not
 * compile. It removes a class of mistake; it is not enforcement. The server's
 * `400` remains the control, exactly as with every other client-side shape here.
 */
export type CreateUserPayload =
  | (CreateUserBase & { account_id: string; account?: never })
  | (CreateUserBase & { account: NewAccountSpec; account_id?: never })

/**
 * A partial change. Every field is optional and **an absent field is not
 * written** — absent and empty are different things, which is why sending only
 * `status` leaves the account untouched.
 *
 * An empty body is a `400` rather than a no-op, because every non-empty change
 * bumps `token_epoch` and logs the user out of every session: "changed nothing"
 * and "logged someone out of everywhere" must not share a response.
 *
 * `roles` **replaces** the set rather than merging into it, so a form sending a
 * partial selection silently revokes the rest.
 */
export interface UpdateUserPayload {
  email?: string
  /**
   * Must name an existing account. An empty value is refused — it would leave
   * the user able to address nothing — and this client sends it anyway rather
   * than editing the request: see `omitUntouched`.
   */
  account_id?: string
  status?: UserStatus
  roles?: string[]
}

/**
 * Drop only `undefined`. Every other value, `''` included, is sent.
 *
 * This is not `clean()` from `@/api/request`, and the difference is the whole
 * point of the function. `clean()` drops `''` as well, which on this endpoint
 * would silently discard a deliberate edit: `email` is documented as "unique
 * when non-blank; several users may have none", so clearing one is a plausible
 * change and an omitted field means "leave it alone".
 *
 * It also does **not** special-case `account_id: ''`. Blanking an account is
 * refused by the server, and a client that quietly removed the field would
 * either produce an unexplained no-op or — when it was the only change — an
 * empty body the server answers `400` to. Editing away the operator's intent is
 * worse than forwarding it: the server's rejection is the message, and there is
 * no client-invented rejection anywhere in this module.
 */
export function omitUntouched<T extends object>(payload: T): Partial<T> {
  const out: Partial<T> = {}
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) continue
    out[key as keyof T] = value as T[keyof T]
  }
  return out
}

/**
 * One page of users, ordered by `user_id`.
 *
 * **The response is a flat array with no total**, so there is no page count to
 * build a numbered pager from — "next/previous" driven by whether a page came
 * back full is the honest shape, and this client invents no count. `limit`
 * defaults to 100 server-side and is capped at 500.
 */
export async function listUsers(page?: { limit?: number; offset?: number }): Promise<AdminUser[]> {
  return (await results<AdminUser[]>(http.get('/auth/users', { params: page }))) ?? []
}

export async function getUser(userId: string): Promise<AdminUser> {
  return results(http.get(`/auth/users/${enc(userId)}`))
}

export async function createUser(payload: CreateUserPayload): Promise<AdminUser> {
  return results(http.post('/auth/users', payload))
}

/**
 * Apply a partial change. The payload is pruned of untouched fields only — see
 * `omitUntouched` — and an empty result is forwarded as the empty body the
 * server is documented to refuse, rather than being turned into a client-side
 * error the message table has no entry for.
 */
export async function updateUser(
  userId: string,
  payload: UpdateUserPayload,
): Promise<AdminUser> {
  return results(http.patch(`/auth/users/${enc(userId)}`, omitUntouched(payload)))
}

/**
 * Delete a user and revoke every session they hold, in one transaction — a
 * deleted user whose 30-day refresh lineage survived would be a credential for a
 * row that no longer exists.
 *
 * The response carries the envelope only.
 */
export async function deleteUser(userId: string): Promise<void> {
  await http.delete(`/auth/users/${enc(userId)}`)
}

/**
 * An administrative reset on someone else's account.
 *
 * There is no `current_password` field, deliberately: asking an administrator
 * for the value they are replacing would be asking for one they legitimately do
 * not know. It bumps `token_epoch` and revokes every refresh-token family the
 * user holds — a password change whose old sessions keep working is not a
 * password change.
 *
 * The response carries the envelope only: a reset has nothing to report that the
 * caller did not already send.
 */
export async function resetUserPassword(userId: string, password: string): Promise<void> {
  await http.post(`/auth/users/${enc(userId)}/password`, { password })
}
