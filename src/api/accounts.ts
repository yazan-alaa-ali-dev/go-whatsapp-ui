import { http, results } from '@/lib/http'

/**
 * The nine account endpoints, typed off the reference's OpenAPI specification
 * rather than off its prose. Where the two disagree the prose wins — it says so
 * itself — and the one place they do is recorded on `AccountDevice` below.
 *
 * **`clean()` is not used anywhere in this module, and that is load-bearing.**
 * `@/api/request` exports a payload cleaner that drops `undefined` *and* `''`.
 * `PATCH /accounts/{id}/devices/{device_id}` takes a closed list — `''` (usable)
 * or `'blocked'` (skipped) — and `''` is the **only** way to unblock a device.
 * Running that helper over this payload turns "unblock this device" into an
 * empty body, silently, and leaves an operator with no way to unblock anything.
 */

const enc = encodeURIComponent

/**
 * One account.
 *
 * `sms_fallback_enabled` is **always present** — no `omitempty` — so an account
 * created before that endpoint existed reports `false` rather than being absent.
 *
 * There is no `meta_token_ref` here and there never will be: the specification
 * says the schema "deliberately carries NO meta_token_ref field", because the
 * value it names points at a credential. It exists on the *create request*
 * (below) and on no response.
 */
export interface Account {
  account_id: string
  name: string
  sms_fallback_enabled: boolean
  created_at: string
  updated_at: string
}

/**
 * One device as its account sees it.
 *
 * `fallback_allowed` and `fallback_reason` are **optional on evidence, not on
 * preference**: the reference's prose (§05) carries both fields on this object
 * and the OpenAPI `AccountDevice` schema lists neither. Optional is the shape
 * that is true under both halves of the document — render them if present,
 * ignore them if absent.
 *
 * And `fallback_allowed` is half an answer even when it is there. It says
 * whether channel-switching policy permits this device; it does not say the
 * device is ready. Sending also requires `send_state !== 'blocked'` and a live
 * session, so the label is "allowed as fallback", never "ready".
 */
export interface AccountDevice {
  device_id: string
  jid: string
  /** `''` is read as `whatsmeow`. */
  transport: '' | 'whatsmeow' | 'meta_cloud'
  /** Reply order inside the account. LOWER = tried first; 100 is "unordered". */
  priority: number
  send_state: SendState
  fallback_allowed?: boolean
  /** A coded reason, present when the fallback is not allowed. */
  fallback_reason?: string
}

/**
 * The closed list `PATCH /accounts/{id}/devices/{device_id}` accepts. Anything
 * else is a `400`. `''` is legitimate and required — see the module header.
 */
export type SendState = '' | 'blocked'

export interface CreateAccountPayload {
  /** Optional; generated when omitted. Naming an existing account is a `409` — this is not an upsert. */
  account_id?: string
  name: string
  /**
   * A **reference** to a Meta access token: the NAME of an environment variable
   * carrying the configured prefix (`META_TOKEN_` by default), never the token
   * itself. A literal token, or a name outside the prefix, is rejected. The
   * value is never returned in any response and never logged — which is why it
   * appears here and on no response type.
   */
  meta_token_ref?: string
}

/**
 * Whether to destroy the account's devices along with it.
 *
 * A union rather than two optional fields, because `expected_devices` "is never
 * defaulted — a missing value is not read as zero", and it must equal the
 * account's current device count exactly or the call is a `409`. A shape that
 * cannot be under-filled is the cheapest enforcement of that. The count belongs
 * to a *live* read of the account's devices, never to a cached list: two
 * correctly-shaped ids both name a real account, and the count is the only thing
 * separating them before an irreversible purge begins.
 */
export type DeleteAccountOptions =
  | { purgeDevices: false }
  | { purgeDevices: true; expectedDevices: number }

/**
 * The outcome of a delete — a **partial-execution report**, not a boolean.
 *
 * `account_deleted` is the only field that answers "is this account gone?": the
 * cascade legitimately finishes without deleting it when a device failed, when
 * the request deadline stopped the loop, or when a device was attached while it
 * ran. A "deleted" message shown on a `200` without reading this field lies to
 * the operator on every partial run.
 *
 * The operation is safe to re-run — whatever was not purged is still owned by
 * the account — so `account_deleted === false` is a handle for a retry rather
 * than an error.
 */
export interface DeleteAccountResult {
  account_id: string
  account_deleted: boolean
  /** Destroyed by this call, in the order they were destroyed. */
  purged_devices: string[]
  /** Purges that returned an error. The account is kept whenever this is non-empty. */
  failed_devices: string[]
  /** Never reached, because the deadline expired. Untouched, not half-purged. */
  not_attempted_devices: string[]
}

/** The state `PATCH /accounts/{id}/sms-fallback` reports back. */
export interface SmsFallbackState {
  account_id: string
  sms_fallback_enabled: boolean
}

/**
 * Every account this caller may see — all of them for a holder of
 * `accounts.manage.all`, and their own alone for anyone else. One screen serves
 * both; there is no branch to write.
 */
export async function listAccounts(): Promise<Account[]> {
  return (await results<Account[]>(http.get('/accounts'))) ?? []
}

/** `accounts.manage.all` only. Naming an existing account answers `409`. */
export async function createAccount(payload: CreateAccountPayload): Promise<Account> {
  return results(http.post('/accounts', payload))
}

/**
 * Delete an account, optionally with the devices it owns.
 *
 * Both parameters travel in the **query string**, as the specification declares
 * them. Purging destroys a device's WhatsApp session keys and re-pairing needs
 * physical access to the customer's phone, so the cascade is never a side
 * effect: an account that still owns devices is refused with
 * `409 ACCOUNT_HAS_DEVICES` unless it is asked for explicitly.
 */
export async function deleteAccount(
  accountId: string,
  options: DeleteAccountOptions = { purgeDevices: false },
): Promise<DeleteAccountResult> {
  const params = options.purgeDevices
    ? { purge_devices: true, expected_devices: options.expectedDevices }
    : undefined
  return results(http.delete(`/accounts/${enc(accountId)}`, { params }))
}

/**
 * The account's devices in reply order — the **authoritative** answer to which
 * devices an account owns, because it reads the device rows, which is what the
 * reply path reads. `GET /devices?account_id=` answers the same question from
 * the live registry: it carries connection state but cannot show a row the
 * registry did not load.
 */
export async function listAccountDevices(accountId: string): Promise<AccountDevice[]> {
  return (await results<AccountDevice[]>(http.get(`/accounts/${enc(accountId)}/devices`))) ?? []
}

/**
 * Link an **existing** device slot to the account. It never creates a slot and
 * never sets a priority. Re-attaching to the same account is idempotent;
 * attaching a device that belongs elsewhere answers `409`. Returns the account's
 * whole device list.
 */
export async function attachDeviceToAccount(
  accountId: string,
  deviceId: string,
): Promise<AccountDevice[]> {
  return (
    (await results<AccountDevice[]>(
      http.post(`/accounts/${enc(accountId)}/devices`, { device_id: deviceId }),
    )) ?? []
  )
}

/**
 * Create a device slot **owned by the account from its first stored row** — so
 * there is no window in which the device exists belonging to nobody. That
 * window is the reason this exists next to `POST /devices`, which the reference
 * does not say attaches anything.
 *
 * `deviceId` is optional and is generated when omitted. An account that does not
 * exist answers `404` and creates nothing; an id already taken answers `409` and
 * is never taken over.
 */
export async function createDeviceInAccount(
  accountId: string,
  deviceId?: string,
): Promise<AccountDevice> {
  const body = deviceId === undefined ? {} : { device_id: deviceId }
  return results(http.post(`/accounts/${enc(accountId)}/devices/create`, body))
}

/**
 * Rewrite the reply order from the **complete** ordered list. Sending the whole
 * order is what stops two devices holding the same priority: a list that omits a
 * device of the account, repeats one, or names a device of another account is
 * rejected and nothing is written. At most 256 entries. LOWER = tried first.
 */
export async function setAccountDeviceOrder(
  accountId: string,
  order: string[],
): Promise<AccountDevice[]> {
  return (
    (await results<AccountDevice[]>(
      http.put(`/accounts/${enc(accountId)}/devices/order`, { order }),
    )) ?? []
  )
}

/**
 * Mark a device blocked or usable.
 *
 * `''` is a value here, not a missing field — it is the only way to clear the
 * flag — so this payload is built literally and never passed through a helper
 * that drops empty fields. Ordering and blocking are orthogonal: a blocked
 * device stays in the order and is skipped when sending, so a UI must not remove
 * it from the list, or unblocking becomes unreachable.
 */
export async function setAccountDeviceSendState(
  accountId: string,
  deviceId: string,
  sendState: SendState,
): Promise<AccountDevice> {
  return results(
    http.patch(`/accounts/${enc(accountId)}/devices/${enc(deviceId)}`, { send_state: sendState }),
  )
}

/**
 * Arm or disarm this account's SMS fallback. Idempotent.
 *
 * `sms_fallback_enabled` must be a real JSON boolean — a string like `"yes"`, a
 * number, or an omitted field is a `400` and nothing is written.
 *
 * **Two switches, and only one of them is here.** This arms the *account*; the
 * deployment must separately carry a complete gateway configuration. Arming an
 * account whose gateway is unconfigured is allowed and is not an error, and this
 * response deliberately does not report the deployment's configuration. So UI
 * copy must not promise delivery: "enabled for this account — it works once the
 * operator has configured the gateway", never "SMS messages enabled".
 */
export async function setAccountSmsFallback(
  accountId: string,
  enabled: boolean,
): Promise<SmsFallbackState> {
  return results(
    http.patch(`/accounts/${enc(accountId)}/sms-fallback`, { sms_fallback_enabled: enabled }),
  )
}
