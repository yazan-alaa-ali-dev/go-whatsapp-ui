import type { DeviceStatus, LoginQr, PairCode, RegistryDevice } from '@/api/types'
import { http, results } from '@/lib/http'

export interface AddDevicePayload {
  device_id?: string
  webhook_url?: string
  webhook_secret?: string
  webhook_events?: string
  webhook_insecure_skip_verify?: boolean
}

const enc = encodeURIComponent

/**
 * The devices this caller may address, optionally narrowed to one account.
 *
 * The filter **only ever narrows**: naming another account answers `200` with an
 * empty list rather than an error, deliberately, so the response cannot be used
 * to discover which accounts exist. A malformed id is still refused with `400`,
 * and that `400` is a different state from the empty list — it rejects the
 * promise, and nothing here turns it into `[]`.
 *
 * `accountId` is the *effective* filter and is expected to have been through
 * `scopedDeviceFilter` (`@/lib/device-scope`), which holds the permission gate
 * and the blank guard. The `accountId ?` below is the type-level truth that
 * follows from it — a blank is no filter — not a second copy of that policy.
 *
 * The `?? []` covers a 2xx carrying no `results`, never a rejection.
 */
export async function listDevices(accountId: string | null = null): Promise<RegistryDevice[]> {
  const params = accountId ? { account_id: accountId } : undefined
  return (await results<RegistryDevice[]>(http.get('/devices', { params }))) ?? []
}

export async function addDevice(payload: AddDevicePayload): Promise<RegistryDevice> {
  return results(http.post('/devices', payload))
}

export async function removeDevice(deviceId: string): Promise<void> {
  await http.delete(`/devices/${enc(deviceId)}`)
}

export async function loginDevice(deviceId: string): Promise<LoginQr> {
  return results(http.get(`/devices/${enc(deviceId)}/login`))
}

export async function loginDeviceWithCode(deviceId: string, phone: string): Promise<PairCode> {
  return results(
    http.post(`/devices/${enc(deviceId)}/login/code`, undefined, { params: { phone } }),
  )
}

export async function logoutDevice(deviceId: string): Promise<void> {
  await http.post(`/devices/${enc(deviceId)}/logout`)
}

export async function reconnectDevice(deviceId: string): Promise<void> {
  await http.post(`/devices/${enc(deviceId)}/reconnect`)
}

export async function deviceStatus(deviceId: string): Promise<DeviceStatus> {
  return results(http.get(`/devices/${enc(deviceId)}/status`))
}

/**
 * A device webhook configuration, as `PATCH /devices/{id}/webhook` returns it.
 *
 * The switch is deliberately **not** on this shape. The OpenAPI text carries
 * `webhook_enabled` on the `GET` response and on nothing else, and typing the
 * `PATCH` result as though it carried the switch is how a stale value ends up
 * rendered after a save.
 */
export interface DeviceWebhookSettings {
  device_id: string
  webhook_url: string
  webhook_secret: string
  webhook_events: string
  webhook_insecure_skip_verify: boolean
}

/**
 * The same configuration plus the delivery switch, as `GET` returns it.
 *
 * `webhook_enabled` answers whether delivery is currently switched **on** for
 * this device. A device that has never been disabled reports `true`, and so does
 * a device with **no** webhook configuration at all — absence of configuration
 * is not the same as being silenced.
 *
 * It is optional here on evidence rather than preference: the field is
 * documented without `omitempty`, but a deployment predating the switch omits
 * it, and reading an omission as `false` would report a delivering device as
 * silenced. `webhookEnabledFrom` in `@/lib/device-webhook` owns that default and
 * says whether the value was reported or inferred.
 */
export interface DeviceWebhookConfig extends DeviceWebhookSettings {
  webhook_enabled?: boolean
}

export interface UpdateDeviceWebhookPayload {
  /**
   * Required by the API. **An empty string is a deletion, not a disable** — it
   * erases the URL, the secret and the event list, after which this device's
   * events fall back to the deployment-wide webhook list, so events keep going
   * out, just somewhere else. To stop delivery without losing anything, use
   * `setDeviceWebhookEnabled` below.
   */
  webhook_url: string
  webhook_secret?: string
  webhook_events?: string
  webhook_insecure_skip_verify?: boolean
}

export async function getDeviceWebhook(deviceId: string): Promise<DeviceWebhookConfig> {
  return results(http.get(`/devices/${enc(deviceId)}/webhook`))
}

export async function updateDeviceWebhook(
  deviceId: string,
  payload: UpdateDeviceWebhookPayload,
): Promise<DeviceWebhookSettings> {
  return results(http.patch(`/devices/${enc(deviceId)}/webhook`, payload))
}

/** What `PATCH /devices/{id}/webhook/enabled` reports back. */
export interface DeviceWebhookState {
  /** Echoed as submitted, never a resolved slot id. */
  device_id: string
  /** The state now in effect. */
  webhook_enabled: boolean
}

/**
 * Switch webhook delivery on or off for one device, leaving its stored
 * configuration exactly as it is.
 *
 * **This is not the same as clearing `webhook_url`** — see
 * `UpdateDeviceWebhookPayload` above. While `enabled` is `false`: nothing is
 * delivered to the device's webhook URL; nothing falls back to the global list,
 * because disabling means silence and not redirection; and the AI agent bridge
 * is not called for this device, so no automatic reply is sent to the customer.
 * Incoming messages are still received and stored, and manual replies still
 * work. Setting it back to `true` resumes delivery to the same URL with the same
 * secret and event list — no restart, no re-pairing, nothing re-entered.
 *
 * `enabled` must be a real JSON boolean: a string such as `"yes"`, a number, or
 * an omitted field is refused with `400` and nothing is written. So the body is
 * built literally and never passed through `clean()` from `@/api/request`, which
 * drops `undefined` *and* `''` — the same trap `src/api/accounts.ts` documents
 * at length for the send-state endpoint. The call is idempotent.
 */
export async function setDeviceWebhookEnabled(
  deviceId: string,
  enabled: boolean,
): Promise<DeviceWebhookState> {
  return results(http.patch(`/devices/${enc(deviceId)}/webhook/enabled`, { enabled }))
}
