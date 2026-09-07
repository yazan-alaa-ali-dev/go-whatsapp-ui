import type { RegistryDevice } from '@/api/types'

/**
 * How the account lens becomes — or fails to become — a request parameter, and
 * how the three privileged device fields are read.
 *
 * Pure: no store, no React, no axios. Everything with a decision in it lives
 * here rather than inside a hook, because this repository has no component
 * renderer in its test environment and a decision that can only be observed by
 * mounting a tree cannot be proven.
 */

/**
 * The `account_id` to send with `GET /devices`, or `null` for no parameter.
 *
 * Three rules in one place, because each of them is a way the request goes
 * wrong on its own:
 *
 * 1. **The permission gate.** The reference's own note on the parameter reads
 *    "Requires `accounts.manage` to be configured; without it the filter
 *    answers 503, like the /accounts endpoints." That most naturally describes
 *    a *deployment* precondition rather than the caller's grant — but the gate
 *    is right under either reading. If the permission is not configured, an
 *    unasked-for `503` becomes a broken-server message the UI manufactured. And
 *    a caller without `accounts.manage` "sees only the devices of their own
 *    account" already, while the parameter "can only NARROW that set" — so for
 *    them the filter's only outcomes are *no change* or *an empty list*.
 *
 *    Note which permission: `accounts.manage`, never `accounts.manage.all`.
 *    The `.all` pair answers *may you leave your own account*, and gating on it
 *    here would drop the filter for every `admin` — the primary audience.
 *
 * 2. **The blank guard.** A blank value "is NO FILTER — it never means 'the
 *    devices that have no account'". So a blank is normalised away rather than
 *    sent, and it can never be used to express that second meaning.
 *
 * 3. **The trim**, so a value that is whitespace only is a blank rather than a
 *    malformed id the server answers `400` to.
 *
 * A malformed id that survives all three is *supposed* to reach the server: a
 * `400` and a `200` with an empty list are two different states, and collapsing
 * them here is exactly what AC-9 forbids.
 */
export function scopedDeviceFilter(
  accountId: string | null | undefined,
  mayFilterByAccount: boolean,
): string | null {
  if (!mayFilterByAccount) return null
  const trimmed = accountId?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

/**
 * Does this device carry the field at all?
 *
 * `GET /devices` returns `account_id`, `priority` and `send_state` **only** to a
 * caller holding `accounts.manage`, so their absence is a statement about the
 * caller and not about the device. That makes presence and value two different
 * facts, and the distinction is not one the type can express:
 *
 * - `account_id` **absent** — you are not allowed to see it.
 * - `account_id: ''` — the device belongs to **no account**. The reference is
 *   explicit that the field carries no `omitempty` and that the empty string
 *   "resolves to an EMPTY device set, not to every un-accounted device".
 *
 * `device.account_id === ''` conflates the two. This does not.
 *
 * **This is not the masked-field rule.** `@/lib/redaction` answers a question
 * about message fields under §09, where an absent key is never an error and
 * never accompanied by a 403. These three are a different authority's
 * conditional output, and merging the two vocabularies would merge two
 * authorities. The boundary is asserted, not merely intended: this module and
 * `./redaction` may not import each other, and `./source-policy.test.ts` fails
 * the build if either ever does.
 *
 * And presence is not a grant either. Reading `account_id` off one payload says
 * nothing about what the principal may do — that is `@/lib/permissions`.
 */
export function hasScopedField(
  device: RegistryDevice,
  field: 'account_id' | 'priority' | 'send_state',
): boolean {
  return field in device
}
