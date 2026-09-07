export interface ResponseData<T> {
  code: string
  message: string
  results?: T
}

export interface ApiError {
  status: number
  code: string
  message: string
}

export type DeviceState = 'disconnected' | 'connecting' | 'connected' | 'logged_in'

export interface RegistryDevice {
  id: string
  phone_number?: string
  display_name?: string
  state: DeviceState
  jid?: string
  created_at: string
  /**
   * The three routing fields below are returned by `GET /devices` **only** when
   * the caller holds `accounts.manage`, so their absence is a statement about
   * the caller rather than about the device. Read them by key presence — see
   * `hasScopedField` in `@/lib/device-scope`, which is where that rule and its
   * one real trap are written down.
   *
   * The trap, briefly: an **absent** `account_id` means "you may not see it",
   * while `account_id: ''` means the device belongs to **no account** — the
   * field carries no `omitempty` and the empty string resolves to an empty
   * device set, not to every un-accounted device. `=== ''` conflates the two.
   *
   * These are **not** masked fields. `@/lib/redaction` owns the §09 message
   * vocabulary, an absent key there is never an error, and the two are
   * different authorities that may not import each other.
   */
  account_id?: string
  /** Reply order inside the account. LOWER = tried first; 100 is the default. */
  priority?: number
  /** `''` is usable; `'blocked'` is skipped by the reply fallback. */
  send_state?: string
}

export interface AppInfo {
  version: string
  os: string
  base_path: string
  max_file_size: number
  max_video_size: number
  max_image_size: number
  chatwoot_enabled: boolean
}

export interface LoginQr {
  device_id: string
  qr_link: string
  qr_duration: number
}

export interface PairCode {
  device_id: string
  pair_code: string
}

export interface DeviceStatus {
  device_id: string
  is_connected: boolean
  is_logged_in: boolean
}
