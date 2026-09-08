import type {
  CreateAccountPayload,
  DeleteAccountOptions,
  DeleteAccountResult,
} from '@/api/accounts'
import { toApiError } from '@/lib/api-error'
import type { AdminRejection } from '@/lib/auth-messages'

/**
 * Every decision the account lifecycle makes, as a function of its arguments.
 *
 * **This repository has no component renderer in its test environment**, so a
 * decision written inside JSX is a decision no test can reach — and this is the
 * ticket where a decision going wrong destroys a customer's WhatsApp session
 * keys, which re-pairing recovers only with physical access to their phone. So
 * what to send, which rejection arrived, and what actually happened are lifted
 * out of the dialogs and into here, where they can be asserted and mutated.
 *
 * **The two decisions about the account *lens* are deliberately not here.**
 * `@/lib/surfaces` already owns every decision about the scope and already
 * normalises an id the same way in four places; a third and fourth copy in a
 * second module is the divergence that module exists to prevent. See
 * `shouldLeaveDeletedAccount` and `scopeIsGone` there.
 *
 * Pure: no store, no React, no axios instance. It imports the wire types it
 * decides over, the error normaliser, and the `AdminRejection` union — a type,
 * erased at build. The same shape `@/lib/surfaces` established in z8pmx9mf17.
 */

/**
 * The prefix a `meta_token_ref` must carry.
 *
 * **A client-side constant standing in for a deployment's configuration**, and
 * that is a stated limit rather than an oversight. The reference calls it "the
 * configured prefix (default `META_TOKEN_`)" and this client has no way to read
 * a deployment's configuration — nothing under `src/` may read an environment
 * variable at all. A deployment that configured a different prefix must change
 * this line; until it does, the server stays the authority and its rejection is
 * what the operator sees.
 */
export const META_TOKEN_PREFIX = 'META_TOKEN_'

/**
 * An environment variable's name, carrying the prefix.
 *
 * Deliberately permissive after the prefix — letters, digits and underscores,
 * either case. Being stricter than the server rejects input the server would
 * have taken, and the value being guarded against is not a lowercase name: it is
 * a **literal access token** pasted into the field, which carries no prefix at
 * all and fails on the first character.
 */
const ENV_VAR_NAME = new RegExp(`^${META_TOKEN_PREFIX}[A-Za-z0-9_]+$`)

/**
 * Why this `meta_token_ref` cannot be sent, or `null` when it can.
 *
 * **The field is a name, not a value, and this is the sentence that says so.**
 * The reference is explicit that a literal token is rejected, that the value is
 * never returned in any response and never logged, and that the field exists on
 * the create request and on no response type. The check runs *before* the
 * request for one practical reason: a token pasted here and sent is a token in a
 * request body, in an intermediary's log, and in the browser's own network
 * panel. Client-side is the only place that can be prevented.
 *
 * **The message is a fixed sentence and never interpolates what was typed.**
 * That is the point of the function, not a detail of its wording: the whole
 * hazard is a token reaching a rendered string, and an error message quoting the
 * offending value is the shortest path there. Asserted in the tests.
 *
 * A blank field is not an error. The field is optional and an omitted reference
 * is a legitimate account.
 */
export function metaTokenRefError(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  if (!ENV_VAR_NAME.test(trimmed)) {
    return `This is the NAME of an environment variable on the server, not the token itself. It must start with ${META_TOKEN_PREFIX} and contain only letters, digits and underscores — for example ${META_TOKEN_PREFIX}ALPHA.`
  }
  return null
}

/**
 * The create body, from what the operator typed.
 *
 * **An omitted field and an empty one are different requests.** `account_id` is
 * "generated when omitted"; sending `''` asks the server to name an account the
 * empty string. The same holds for the reference. So both are dropped rather
 * than blanked.
 *
 * **`clean()` from `@/api/request` is not used, and that is deliberate.** It
 * returns `Record<string, unknown>`, so its result reaches `createAccount` only
 * through a cast that discards the typed payload; it does not trim; and the
 * header of `src/api/accounts.ts` states at length that the helper is used
 * **nowhere** in that area, because one endpoint over it turns "unblock this
 * device" into an empty body. Reaching for it from a dialog would re-introduce
 * exactly what that module refuses.
 */
export function createAccountPayloadFrom(fields: {
  accountId: string
  name: string
  metaTokenRef: string
}): CreateAccountPayload {
  const accountId = fields.accountId.trim()
  const metaTokenRef = fields.metaTokenRef.trim()
  return {
    name: fields.name.trim(),
    ...(accountId === '' ? {} : { account_id: accountId }),
    ...(metaTokenRef === '' ? {} : { meta_token_ref: metaTokenRef }),
  }
}

/** The sentence a create failure gets when the server's own text may not be shown. */
export const CREATE_FAILED_REDACTED =
  'The account was not created. The server’s reason is not shown here because this request carried a token reference, and a rejection can quote the field it rejected. Check the reference name and try again.'

/**
 * What to render when a create fails.
 *
 * Three arms rather than a rejection-or-`null`, and the third is the reason:
 *
 * - `notice` — a rejection this caller recognises, rendered from `ADMIN_REJECTIONS`.
 * - `server` — fall through to `toActionErrorMessage`, which already renders a
 *   `403` as a permission rejection while keeping the server's text, and
 *   provably spends no refresh and triggers no logout (`src/lib/http.ts`).
 * - `redacted` — **the request carried a `meta_token_ref` and the server
 *   refused it.** A `400` whose message echoes the offending field would put a
 *   pasted access token straight into a toast. The value is never rendered, so
 *   neither is any server text produced by a request that carried one. The
 *   diagnostic loss is bounded — the operator knows which field they filled in —
 *   and the alternative is a credential on screen.
 *
 * A failure with no server behind it (`status: 0` — offline, DNS, a cancelled
 * request) keeps its text: there is no response to have echoed anything.
 */
export type CreateFailure =
  | { kind: 'notice'; rejection: AdminRejection }
  | { kind: 'server' }
  | { kind: 'redacted' }

export function createFailure(error: unknown, sentReference: boolean): CreateFailure {
  const { status } = toApiError(error)
  // `POST /accounts` documents its 409 as one cause — "an account with this id
  // already exists" — so unlike `POST /auth/users`, which joins three, this one
  // may say what collided without handing back an enumeration oracle: the
  // operator chose the id themselves a second ago.
  if (status === 409) return { kind: 'notice', rejection: 'account-id-taken' }
  if (sentReference && status >= 400) return { kind: 'redacted' }
  return { kind: 'server' }
}

/**
 * Does the typed confirmation match?
 *
 * **The target is the account id, not its name** (`AC-13`, revised after the
 * advisory panel). A name is not unique — only `account_id` is — and it is
 * server-controlled text that `accountName` in `@/lib/surfaces` must strip of
 * Unicode control and format characters and cap at 60 characters, so confirming
 * against it means displaying either a string the operator cannot type or a raw
 * one that re-opens the bidi reordering attack that module closed. The id is
 * already rendered raw, in mono, by `IdText`.
 *
 * Leading and trailing whitespace is forgiven — an id copied out of the table
 * carries it, and this is a confirmation of intent rather than a typing test.
 * Nothing else is: the comparison is case-sensitive and exact.
 *
 * A blank target never matches, so an empty box can never confirm anything.
 */
export function confirmationMatches(typed: string, target: string): boolean {
  const wanted = target.trim()
  if (wanted === '') return false
  return typed.trim() === wanted
}

/**
 * The request the second step sends.
 *
 * **It takes the device list, not a count, and that is the `AC-14` guarantee
 * expressed as a type.** A number is a value anything can mint — a cached count,
 * a stale `getQueryData`, a literal `0` — and every one of those is a
 * type-correct call that every unit test passes. Taking the array that
 * `listAccountDevices` just returned puts the provenance in the signature; a
 * source rule keeps the dialog from reading the cache, so the array cannot come
 * from there either.
 *
 * The reference is explicit that `expected_devices` "is never defaulted — a
 * missing value is not read as zero", and that two correctly-shaped ids both
 * name a real account, so the count is the only thing separating them before an
 * irreversible purge begins.
 *
 * `purgeDevices` is what the operator ticked. Untick it and the request carries
 * no cascade at all, which is what "asked for explicitly" means and what the
 * server refuses with `409 ACCOUNT_HAS_DEVICES` when the account still owns
 * devices. That refusal is rendered rather than pre-empted: the client knows the
 * count it read a moment ago, not the count the server is about to read, and
 * this whole endpoint is designed around that difference.
 */
export function deleteRequestFor(
  purgeDevices: boolean,
  liveDevices: readonly { device_id: string }[],
): DeleteAccountOptions {
  if (!purgeDevices) return { purgeDevices: false }
  return { purgeDevices: true, expectedDevices: liveDevices.length }
}

/**
 * Did the account go?
 *
 * **`account_deleted` answers, and nothing else does.** The reference also says
 * the account is kept whenever `failed_devices` is non-empty, and that is true —
 * but deriving the answer from a second field gives this UI two sources for one
 * question, and the day they disagree is the day a `200` is reported as a
 * deletion that did not happen.
 *
 * It returns the discriminant alone. An earlier draft returned a union carrying
 * renamed copies of `purged_devices`, `failed_devices` and
 * `not_attempted_devices`; that gave the report two names and carried no decision
 * beyond this one boolean read. The dialog renders those three off the response.
 */
export function deleteOutcome(result: DeleteAccountResult): 'deleted' | 'kept' {
  return result.account_deleted ? 'deleted' : 'kept'
}

/**
 * Is this the account the signed-in principal themselves belongs to?
 *
 * For a holder of `accounts.manage` without `.all`, `GET /accounts` returns
 * exactly one row — their own — so the single delete this screen offers them is
 * the deletion of the account they belong to: an irreversible self-lockout with
 * no recovery through the product. `ADMIN_REJECTIONS` already carries a
 * `self-mutation` notice for the equivalent on the users surface.
 *
 * **This drives a warning, never a refusal.** The server is the authority, and a
 * super administrator deleting a decommissioned account they happen to belong to
 * is a legitimate operation this client must not guess about. What it may do is
 * refuse to present it as an ordinary delete.
 *
 * A blank own account is the reference's "belongs to no account" (§05): it owns
 * nothing, so no delete is ever a self-lockout.
 */
export function isOwnAccountDeletion(
  targetAccountId: string,
  ownAccountId: string | null | undefined,
): boolean {
  const own = ownAccountId?.trim() ?? ''
  return own !== '' && own === targetAccountId.trim()
}

/**
 * The two `409` codes the reference names.
 *
 * **Inferred, not transcribed.** They appear only in prose descriptions of a
 * `409` — never inside a rendered envelope — and the `ErrorBadRequest` schema
 * shows `code` carrying the HTTP status as a string. So a match is a bonus and
 * the classifier below never depends on one.
 */
const HAS_DEVICES_CODE = 'ACCOUNT_HAS_DEVICES'
const COUNT_MISMATCH_CODE = 'ACCOUNT_DEVICE_COUNT_MISMATCH'

/**
 * Which rejection a failed delete is, or `null` to fall through.
 *
 * `@/lib/auth-messages` states that it holds **no classifier on purpose**: "a
 * caller that knows which request it just made is better placed to pick an entry
 * than a function guessing from a status code." This is that caller, and
 * `askedForCascade` is the knowledge a status code does not carry — only one of
 * the two `409`s is reachable for a given request shape, so the fallback is
 * exact rather than a guess.
 *
 * **A recorded assumption.** Both notices assert that nothing was purged and
 * nothing deleted, which is true of every `409` the reference documents: all of
 * them are raised before the cascade starts. A `409` raised *mid-cascade* would
 * be rendered here as a false all-clear. This sentence exists so that the day the
 * server adds one, the place to change is findable.
 *
 * `null` is a real answer and the important one: a `403` falls through to
 * `toActionErrorMessage`, which already renders a permission rejection while
 * keeping the server's text and — provably, in `src/lib/http.ts` — spends no
 * refresh and triggers no logout. Nothing here may re-implement that.
 */
export function deleteRejection(error: unknown, askedForCascade: boolean): AdminRejection | null {
  const { status, code } = toApiError(error)
  if (status === 404) return 'not-found'
  if (status !== 409) return null
  if (code === HAS_DEVICES_CODE) return 'account-has-devices'
  if (code === COUNT_MISMATCH_CODE) return 'account-device-count-mismatch'
  return askedForCascade ? 'account-device-count-mismatch' : 'account-has-devices'
}
