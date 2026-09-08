import { toApiError } from '@/lib/api-error'

/**
 * The one setting an account carries, and every sentence this app says about it.
 *
 * Pure: no store, no React, no axios. The copy lives here rather than inside the
 * card for the reason every decision in this repository does — there is no
 * component renderer in this test environment, so a sentence written in JSX is a
 * sentence nobody can assert, and the acceptance criteria for this screen are
 * almost entirely *about the sentences*.
 *
 * **What the switch is, precisely.** `PATCH /accounts/{id}/sms-fallback` arms the
 * ACCOUNT. The deployment must separately carry a complete gateway configuration
 * (`SMS_GATEWAY_URL`, `SMS_GATEWAY_KEY`, `SMS_SENDER_ID`), and the response
 * deliberately does not report whether it does — that belongs to the operator,
 * not to the account. Arming an account whose gateway is unconfigured is allowed
 * and is **not** an error. So the copy below promises nothing about delivery, and
 * the test file asserts that it does not.
 *
 * **There is no payload builder here**, and its absence is deliberate. An earlier
 * draft added one "so the JSON boolean is a tested value", justified by a claim
 * that `clean()` would drop `false` — which is untrue: that helper skips
 * `undefined` and `''` and passes `false` through. The body that actually goes on
 * the wire is built literally inside `setAccountSmsFallback`, in a module a source
 * rule already forbids from naming a payload cleaner at all, and
 * `src/api/accounts.test.ts` already asserts it for `true` and for `false`. A
 * helper asserting a value nothing sends is worse than no helper: it reads like
 * the thing keeping the guarantee, so the real guard becomes safe to relax.
 */

/**
 * What the switch may show.
 *
 * `unknown` is a first-class answer rather than a loading flag, because the three
 * ways the value can be missing are all ways `off` would be a **lie**: the
 * account list is pending, it was refused, or it does not carry this account.
 * Rendering `false` for a value nobody has read says *disarmed* on the one screen
 * whose whole subject is not claiming things the server did not say.
 */
export type SmsFallback = 'on' | 'off' | 'unknown'

/**
 * This account's current fallback state, out of the account list.
 *
 * There is no `GET /accounts/{id}` (study §14, `Q-5`), so the list is the only
 * source. The parameter is structurally typed rather than imported from
 * `@/api/accounts` so this module's import list stays one line long — the same
 * treatment `@/lib/surfaces` gives the account name.
 *
 * `sms_fallback_enabled` is documented as **always present** — no `omitempty` —
 * so an account created before the endpoint existed reports `false` rather than
 * being absent. That is why a found account is never `unknown`: the field being
 * missing would mean the server broke its own contract, and reading it as
 * "disarmed" is then the wrong repair. It is treated as unknown only by not
 * being a boolean at all.
 */
export function smsFallbackState(
  accounts: readonly { account_id: string; sms_fallback_enabled: boolean }[] | undefined,
  accountId: string,
): SmsFallback {
  const found = accounts?.find((account) => account.account_id === accountId)
  if (found === undefined) return 'unknown'
  if (typeof found.sms_fallback_enabled !== 'boolean') return 'unknown'
  return found.sms_fallback_enabled ? 'on' : 'off'
}

/**
 * Which notice a refused toggle gets.
 *
 * Three outcomes, and each one is a decision about what this screen is entitled
 * to claim:
 *
 * - `not-found` — the `404`. The reference documents it as **byte-identical**
 *   for an account that does not exist and an account belonging to another
 *   tenant, "because doing so would confirm the account's existence to a caller
 *   who may not address it". `ADMIN_REJECTIONS['not-found']` already refuses to
 *   tell the two apart, so it is reused rather than reworded; guessing which of
 *   the two happened would hand back the tenant-enumeration oracle the backend
 *   withheld.
 * - `permission` — the `403`. It maps to `PERMISSION_DENIED`, **not** to
 *   `ADMIN_REJECTIONS['privilege-escalation']`. That notice is user-administration
 *   copy — "you cannot grant a permission you do not hold yourself, and you
 *   cannot change or delete a user who holds one" — and rendering it here would
 *   invent a cause the wire never stated, on a screen about an account setting.
 * - `unknown` — everything else, including the `400` this client cannot produce
 *   (the body is a boolean by type). The caller falls back to
 *   `toActionErrorMessage`, which keeps whatever the server wrote. There is no
 *   credential in this request, so there is nothing to redact and the
 *   `PASSWORD_FAILED_REDACTED` treatment does not apply.
 */
export type SmsFallbackFailure = 'not-found' | 'permission' | 'unknown'

export function smsFallbackFailure(error: unknown): SmsFallbackFailure {
  const { status } = toApiError(error)
  if (status === 404) return 'not-found'
  if (status === 403) return 'permission'
  return 'unknown'
}

/**
 * What arming the account means — and, as importantly, what it does not.
 *
 * The reference's own wording, condensed: "enabled for this account — it works
 * once the operator has configured the gateway", never "SMS messages enabled".
 */
export const SMS_FALLBACK_ARMED =
  'Armed at the account level. A text message that failed on every WhatsApp channel available to this account may then be delivered to the same recipient as an SMS.'

/**
 * The second switch, the one this screen does not hold.
 *
 * Two facts have to survive together here: arming an account whose gateway is
 * unconfigured is *allowed and is not an error*, and this screen *cannot tell you
 * whether the gateway is configured*. Stating the first without the second reads
 * as "it is on now"; stating the second without the first reads as a warning that
 * something is wrong.
 */
export const SMS_FALLBACK_GATEWAY =
  'This is one of two switches. The deployment must separately carry a complete SMS gateway configuration, which the operator owns. Arming an account before that is done is allowed and is not an error — the state is stored and takes effect the day the gateway is configured. This response deliberately does not report the deployment’s configuration, so this screen cannot tell you whether it is in place.'

/**
 * Where the fallback sits in the order, which is the part most easily misread as
 * "messages now go out over SMS".
 */
export const SMS_FALLBACK_ORDER =
  'It is the last stage, never the first. A WhatsApp send that succeeded never produces an SMS, and neither does a failure that occurred while sending — if the message was already handed to the socket, WhatsApp may still hold it, and one undelivered message is preferred over the same text arriving twice from two channels.'

/** What changes, and what does not, when the switch is thrown. */
export const SMS_FALLBACK_EFFECT =
  'The change takes effect on the next send attempt, with no restart and no re-pairing. The call is idempotent — sending the same value twice returns the same result.'

/** The credentials this screen does not accept, said out loud. */
export const SMS_FALLBACK_CREDENTIALS =
  'Gateway credentials are never entered here. They come from the deployment environment only.'

/**
 * Everything the fallback does not cover, verbatim from the endpoint's own
 * description. It is a list rather than a paragraph because each line is a
 * separate thing an operator will otherwise assume.
 */
export const SMS_FALLBACK_EXCLUSIONS: readonly string[] = Object.freeze([
  'Media, stickers, contacts, locations and polls carry no SMS equivalent and are never re-sent.',
  'A group recipient gets no SMS.',
  'A recipient that resolves to no dialable E.164 number gets no SMS.',
  'At most one SMS is sent per failed message, and the gateway is never retried.',
])
