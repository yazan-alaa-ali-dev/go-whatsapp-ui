import type { AccountDevice, SendState } from '@/api/accounts'
import type { DeviceState, RegistryDevice } from '@/api/types'
import { toApiError } from '@/lib/api-error'
import type { AdminRejection } from '@/lib/auth-messages'
import { hasScopedField } from '@/lib/device-scope'

/**
 * Every decision the account devices surface makes, as a function of its
 * arguments.
 *
 * **This repository has no component renderer in its test environment**, so a
 * decision written inside JSX is a decision no test can reach. The two decisions
 * this screen gets wrong most easily are both invisible from the outside — which
 * of two endpoints a row came from, and whether an order payload is complete —
 * and a wrong answer to either is silent: the list simply omits devices, and the
 * order endpoint then answers `400` for a reason nothing on screen explains. So
 * the join, the position, the order payload, the send-state toggle and the
 * rejection vocabulary live here, where they can be asserted and mutated.
 *
 * Pure: no store, no React, no axios instance. It imports the wire types it
 * decides over, the error normaliser, the `AdminRejection` union (a type, erased
 * at build) and `hasScopedField` — the same shape `@/lib/surfaces` established in
 * z8pmx9mf17 and `@/lib/account-lifecycle` in z8pmx9mf18.
 *
 * **The webhook decisions are deliberately not here.** They are about a
 * *device*, not about an account, and the dialog that asks them is mounted from
 * the global device dashboard as well as from this surface. See
 * `@/lib/device-webhook`.
 */

/**
 * The most entries `PUT /accounts/{id}/devices/order` accepts.
 *
 * Transcribed from the reference, not chosen here. It is enforced client-side
 * for one reason: the endpoint rewrites the order from the *complete* list, so
 * an account over the limit cannot have its order expressed at all — and
 * discovering that as a `400` after a drag would read as a broken control rather
 * than as the documented ceiling it is.
 */
export const MAX_ORDER_ENTRIES = 256

/**
 * One device of an account, from both sources, with the row as the authority.
 *
 * `registry` is `undefined` when the live registry did not load this device.
 * That is a **third state**, not a synonym for disconnected, and keeping the
 * whole registry entry rather than flattening it into fields is what makes that
 * inexpressible: there is no `state` to read on an entry that is not there.
 */
export interface JoinedAccountDevice {
  /** The authoritative membership record — `GET /accounts/{id}/devices`. */
  row: AccountDevice
  /** The live registry entry — `GET /devices?account_id=` — or `undefined`. */
  registry: RegistryDevice | undefined
  /** 1-based reply position, from the order the row endpoint returned. */
  position: number
}

/**
 * The two sources, joined.
 *
 * **A left join on the rows, and the direction is the whole point.** The rows
 * are what the reply path itself reads, so they are the authoritative answer to
 * which devices an account owns; the registry carries connection state but
 * "cannot show a row the registry did not load" (study §08). Joining the other
 * way — building the list from the registry and looking up rows — silently drops
 * devices that exist, and the next thing the operator does is reorder, which
 * then submits an incomplete list and is refused with `400`. That is not a
 * hypothetical failure mode; it is the one the study calls out by name.
 *
 * So: every row produces exactly one entry, in the order the endpoint returned
 * them, and a registry entry with no row produces nothing.
 *
 * The registry is indexed once into a `Map` rather than scanned per row — the
 * list is bounded at `MAX_ORDER_ENTRIES`, but a nested scan over two 256-entry
 * arrays for every render of a screen an operator sits on is avoidable for one
 * line.
 *
 * Both arguments tolerate `undefined`, because both are TanStack query data and
 * either can still be in flight. A missing registry yields a list where every
 * device reads as "not loaded", which is exactly true while the read is running.
 */
export function joinAccountDevices(
  rows: readonly AccountDevice[] | undefined,
  registry: readonly RegistryDevice[] | undefined,
): JoinedAccountDevice[] {
  const byId = new Map((registry ?? []).map((device) => [device.id, device]))
  return (rows ?? []).map((row, index) => ({
    row,
    registry: byId.get(row.device_id),
    position: index + 1,
  }))
}

/**
 * The connection state of a joined row.
 *
 * **An absent registry entry is `'unknown'`, never `'disconnected'`.** The two
 * look alike on screen and mean opposite things: `disconnected` is a fact the
 * server reported about a device it has loaded, and an absent entry is the
 * absence of any fact at all. Reporting the second as the first tells an
 * operator their customer is offline when nothing of the sort is known — and it
 * is the reading that makes them delete and re-pair a device that was fine,
 * which destroys its WhatsApp session keys.
 *
 * One line, and a named function with its own test rather than a `??` inside
 * JSX, because it is the single most consequential line on this screen.
 */
export function connectionOf(registry: RegistryDevice | undefined): DeviceState | 'unknown' {
  return registry?.state ?? 'unknown'
}

/**
 * What a move produces: a request, nothing, or a refusal.
 *
 * Three arms rather than `string[] | null`, because "nothing to do" and "this
 * cannot be expressed" are different outcomes and only one of them has something
 * to say to the operator.
 */
export type OrderSubmission =
  { kind: 'submit'; order: string[] } | { kind: 'noop' } | { kind: 'refused'; reason: string }

/**
 * The order payload for moving one device up or down.
 *
 * **It takes the rows, not a list of ids, and that is the completeness
 * guarantee expressed as a type.** A `string[]` is a value anything can mint —
 * including a list built from the registry query, which is exactly the bug this
 * module exists to prevent, and which type-checks perfectly. Taking the array
 * that `listAccountDevices` returned puts the provenance in the signature. It is
 * the same trick `deleteRequestFor` uses in `@/lib/account-lifecycle` for
 * `expected_devices`, for the same reason: the argument's *type* is the proof.
 *
 * The result is every row id, once each, in the new order — never a partial
 * list, never a swap of two ids sent alone. The endpoint rewrites the order from
 * the complete list and refuses anything else, and sending the whole set is what
 * stops two devices holding the same priority.
 *
 * `'noop'` covers a device already at the end it is moving toward and an id that
 * is not in the set at all; neither is an error and neither needs a request.
 */
export function orderSubmission(
  rows: readonly AccountDevice[] | undefined,
  deviceId: string,
  direction: 'up' | 'down',
): OrderSubmission {
  const ids = (rows ?? []).map((row) => row.device_id)
  if (ids.length > MAX_ORDER_ENTRIES) {
    return {
      kind: 'refused',
      reason: `This account owns ${ids.length} devices, and the reply order accepts at most ${MAX_ORDER_ENTRIES}. The order is rewritten from the complete list, so it cannot be expressed for this account until it owns fewer devices.`,
    }
  }
  const from = ids.indexOf(deviceId)
  if (from === -1) return { kind: 'noop' }
  const to = direction === 'up' ? from - 1 : from + 1
  if (to < 0 || to >= ids.length) return { kind: 'noop' }
  const order = [...ids]
  order[from] = ids[to]
  order[to] = ids[from]
  return { kind: 'submit', order }
}

/**
 * The send state a toggle sends.
 *
 * **The empty string is the value, not a missing field.** It is the only way to
 * clear the flag, and `src/api/accounts.ts` refuses the payload-cleaning helper
 * across that whole module precisely because running it here turns "unblock this
 * device" into an empty body and leaves an operator with no way to unblock
 * anything. This function is two lines and has its own test for that reason: it
 * is the value a future "drop the empty fields" edit deletes.
 *
 * Anything that is not `'blocked'` blocks, rather than `''` blocking and
 * everything else falling through — the wire type is a closed pair, and a
 * default that blocks is the safe direction if it ever stops being one.
 */
export function toggledSendState(current: SendState): SendState {
  return current === 'blocked' ? '' : 'blocked'
}

/**
 * Did the generic `POST /devices` return a device belonging to **nobody**?
 *
 * The study's §08 danger box: a device with a blank `account_id` "can address
 * nothing and is invisible to its own creator", and whether the generic create
 * path attaches to the caller's account is an open question the reference does
 * not answer (`Q-1`). The safe response is to read what came back and say so.
 *
 * **Presence and value are different facts, and this is why it is not
 * `device.account_id === ''`.** `GET /devices` returns `account_id` only to a
 * caller holding `accounts.manage`, so an **absent** field is a statement about
 * the caller — and the seeded `user` role, which holds `devices.create` and not
 * `accounts.manage`, would see it absent on every create. Comparing to `''`
 * would warn all of them, every time, about a condition nobody has observed.
 * Only a **present, blank** value means the device belongs to no account.
 *
 * `hasScopedField` is imported rather than reimplemented: that module owns this
 * rule and its trap is written down there.
 */
export function createdWithoutAccount(device: RegistryDevice): boolean {
  return hasScopedField(device, 'account_id') && device.account_id === ''
}

/** Which request produced the failure being classified. */
export type DeviceOperation = 'create' | 'attach' | 'order' | 'send-state' | 'delete'

/**
 * Which rejection a failed device operation is, or `null` to fall through.
 *
 * `@/lib/auth-messages` holds no classifier on purpose — "a caller that knows
 * which request it just made is better placed to pick an entry than a function
 * guessing from a status code". This is that caller, and `operation` is the
 * knowledge a status code does not carry: a `409` means a taken id on create and
 * a device owned elsewhere on attach, and no status code distinguishes them.
 *
 * **A `404` is never rendered as a permission problem, and that is this
 * function's one hard rule.** A device belonging to another account answers
 * `404` with a body identical to a device that does not exist, deliberately,
 * because a `403` would confirm the device's existence to a caller who may not
 * address it (reference §06). Repeating a guess about which one it was hands
 * back the oracle the backend withheld. The notice says "not available" and the
 * source policy asserts that it stays that way.
 *
 * **A `403` is deliberately `null`.** It is a different fact — the server
 * refusing the *operation*, not hiding a device's existence — and
 * `toActionErrorMessage` already renders it while keeping the server's own text
 * and, provably in `src/lib/http.ts`, spending no refresh and triggering no
 * logout. Nothing here may re-implement that.
 */
export function deviceRejection(error: unknown, operation: DeviceOperation): AdminRejection | null {
  const { status } = toApiError(error)
  // Create is the one operation whose 404 is about the ACCOUNT in the path
  // rather than about a device: the device does not exist yet, which is the
  // point of the call.
  if (status === 404) return operation === 'create' ? 'account-not-found' : 'device-not-available'
  if (status === 409) {
    if (operation === 'create') return 'device-id-taken'
    if (operation === 'attach') return 'device-belongs-elsewhere'
    return null
  }
  if (status === 400 && operation === 'order') return 'device-order-refused'
  return null
}
