import {
  AxiosError,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useAuth } from '@/stores/auth'
import { useDeviceStore } from '@/stores/device'
import { http } from '@/lib/http'
import {
  type Account,
  type AccountDevice,
  type DeleteAccountResult,
  attachDeviceToAccount,
  createAccount,
  createDeviceInAccount,
  deleteAccount,
  listAccountDevices,
  listAccounts,
  setAccountDeviceOrder,
  setAccountDeviceSendState,
  setAccountSmsFallback,
} from './accounts'

/**
 * The nine account calls, driven through the real interceptor chain with a stub
 * adapter — the harness `http.test.ts` established. Asserting the request rather
 * than mocking the function is what makes these tests worth anything: the wire
 * shapes here were read off the reference's OpenAPI specification, and a test
 * that mocked the client would only assert the reading back to itself.
 */

const originalAdapter = http.defaults.adapter

function respondWith(results: unknown, status = 200): InternalAxiosRequestConfig[] {
  const sent: InternalAxiosRequestConfig[] = []
  const adapter: AxiosAdapter = async (config) => {
    sent.push(config as InternalAxiosRequestConfig)
    const response = {
      status,
      data: { code: status >= 400 ? 'BAD_REQUEST' : 'SUCCESS', message: '', results },
      statusText: '',
      headers: {},
      config,
    } as AxiosResponse
    if (status >= 400) {
      throw new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, undefined, response)
    }
    return response
  }
  http.defaults.adapter = adapter
  return sent
}

beforeEach(() => {
  useAuth.setState({
    access_token: null,
    refresh_token: null,
    access_token_expires_at: null,
    user: null,
    status: 'unknown',
    endReason: null,
  })
  useDeviceStore.setState({ selectedDeviceId: null })
})

afterEach(() => {
  http.defaults.adapter = originalAdapter
})

describe('the account list and create (AC-14, AC-15, AC-16, TC-13)', () => {
  it('reads the list, and an empty envelope is an empty list', async () => {
    respondWith(undefined)
    await expect(listAccounts()).resolves.toEqual([])
  })

  it('carries the five fields the reference gives, sms_fallback_enabled always present', async () => {
    const account: Account = {
      account_id: 'acc-a',
      name: 'Acme Support',
      sms_fallback_enabled: false,
      created_at: '2026-01-14T09:12:00Z',
      updated_at: '2026-02-02T11:40:00Z',
    }
    respondWith([account])

    const [read] = await listAccounts()

    expect(read).toEqual(account)
    // AC-16, asserted rather than assumed: the schema says it "deliberately
    // carries NO meta_token_ref field", because the value names a credential.
    expect(Object.keys(read)).not.toContain('meta_token_ref')
    expect(Object.keys(read).sort()).toEqual([
      'account_id',
      'created_at',
      'name',
      'sms_fallback_enabled',
      'updated_at',
    ])
  })

  it('sends the create body, meta_token_ref included — a request field, never a response one', async () => {
    const sent = respondWith({})

    await createAccount({ account_id: 'acc-new', name: 'New Co', meta_token_ref: 'META_TOKEN_NEW' })

    expect(sent[0].method).toBe('post')
    expect(sent[0].url).toBe('/accounts')
    expect(JSON.parse(sent[0].data as string)).toEqual({
      account_id: 'acc-new',
      name: 'New Co',
      meta_token_ref: 'META_TOKEN_NEW',
    })
  })
})

describe('deleting an account (AC-18, TC-14)', () => {
  it('asks for no cascade by default, and sends no parameters at all', async () => {
    const sent = respondWith({})

    await deleteAccount('acc-a')

    expect(sent[0].method).toBe('delete')
    expect(sent[0].url).toBe('/accounts/acc-a')
    // Never a defaulted expected_devices: "a missing value is not read as zero",
    // and purging destroys WhatsApp session keys that need physical access to
    // the customer's phone to restore.
    expect(sent[0].params).toBeUndefined()
  })

  it('carries the cascade and the count in the QUERY STRING, as the specification declares them', async () => {
    const sent = respondWith({})

    await deleteAccount('acc-a', { purgeDevices: true, expectedDevices: 2 })

    expect(sent[0].params).toEqual({ purge_devices: true, expected_devices: 2 })
    expect(sent[0].data).toBeUndefined()
  })

  it('returns a partial-execution report, not a boolean', async () => {
    // A "deleted" message shown on a 200 without reading account_deleted lies
    // to the operator on every partial run. The cascade legitimately finishes
    // without deleting the account when a device failed or the deadline hit.
    const report: DeleteAccountResult = {
      account_id: 'acc-a',
      account_deleted: false,
      purged_devices: ['dev-a'],
      failed_devices: ['dev-b'],
      not_attempted_devices: ['dev-c'],
    }
    respondWith(report)

    const result = await deleteAccount('acc-a', { purgeDevices: true, expectedDevices: 3 })

    expect(result).toEqual(report)
    expect(typeof result).not.toBe('boolean')
    // False is the handle for a retry: whatever was not purged is still owned.
    expect(result.account_deleted).toBe(false)
    expect(result.not_attempted_devices).toEqual(['dev-c'])
  })
})

describe('the account’s devices (AC-17, TC-13)', () => {
  it('reads the membership list', async () => {
    const device: AccountDevice = {
      device_id: 'dev-a',
      jid: '628123@s.whatsapp.net',
      transport: '',
      priority: 10,
      send_state: '',
    }
    const sent = respondWith([device])

    await expect(listAccountDevices('acc-a')).resolves.toEqual([device])
    expect(sent[0].url).toBe('/accounts/acc-a/devices')
  })

  it('accepts a device that carries the two fields the schema omits', async () => {
    // AC-17: the prose (§05) carries fallback_allowed / fallback_reason and the
    // AccountDevice schema lists neither, so optional is the shape that is true
    // under both halves of the document.
    const device: AccountDevice = {
      device_id: 'dev-a',
      jid: '628123@s.whatsapp.net',
      transport: 'whatsmeow',
      priority: 10,
      send_state: 'blocked',
      fallback_allowed: false,
      fallback_reason: 'blocked',
    }
    respondWith([device])

    const [read] = await listAccountDevices('acc-a')

    expect(read.fallback_allowed).toBe(false)
    expect(read.fallback_reason).toBe('blocked')
  })

  it('attaches an existing device by id and gets the whole list back', async () => {
    const sent = respondWith([])

    await attachDeviceToAccount('acc-a', 'dev-a')

    expect(sent[0].method).toBe('post')
    expect(sent[0].url).toBe('/accounts/acc-a/devices')
    expect(JSON.parse(sent[0].data as string)).toEqual({ device_id: 'dev-a' })
  })

  it('creates a device inside the account, with the id optional', async () => {
    // The body is optional and the id is generated when omitted. This is the
    // preferred path inside an account surface, because it leaves no window in
    // which the device exists belonging to nobody.
    const sent = respondWith({})

    await createDeviceInAccount('acc-a')
    await createDeviceInAccount('acc-a', 'dev-named')

    expect(sent[0].url).toBe('/accounts/acc-a/devices/create')
    expect(JSON.parse(sent[0].data as string)).toEqual({})
    expect(JSON.parse(sent[1].data as string)).toEqual({ device_id: 'dev-named' })
  })

  it('rewrites the order under the key `order`, from the complete list', async () => {
    // The wire field is `order`. A list that omits a device of the account,
    // repeats one, or names another account's device is rejected and nothing is
    // written — so the caller must send the complete set.
    const sent = respondWith([])

    await setAccountDeviceOrder('acc-a', ['dev-b', 'dev-a'])

    expect(sent[0].method).toBe('put')
    expect(sent[0].url).toBe('/accounts/acc-a/devices/order')
    expect(JSON.parse(sent[0].data as string)).toEqual({ order: ['dev-b', 'dev-a'] })
  })
})

describe('an empty send_state is a value, not a missing field', () => {
  it('sends send_state: "" — the only way to unblock a device', async () => {
    // The single worst trap in this API. `clean()` from @/api/request drops ''
    // along with undefined; running it over this payload would turn "unblock
    // this device" into an empty body and leave an operator unable to unblock
    // anything, ever. Nothing in this module uses it.
    const sent = respondWith({})

    await setAccountDeviceSendState('acc-a', 'dev-a', '')

    expect(sent[0].method).toBe('patch')
    expect(sent[0].url).toBe('/accounts/acc-a/devices/dev-a')
    expect(JSON.parse(sent[0].data as string)).toEqual({ send_state: '' })
  })

  it('sends send_state: "blocked" the same way', async () => {
    const sent = respondWith({})

    await setAccountDeviceSendState('acc-a', 'dev-a', 'blocked')

    expect(JSON.parse(sent[0].data as string)).toEqual({ send_state: 'blocked' })
  })

  it('percent-encodes both path segments', async () => {
    const sent = respondWith({})

    await setAccountDeviceSendState('acc/a', 'dev a', 'blocked')

    expect(sent[0].url).toBe('/accounts/acc%2Fa/devices/dev%20a')
  })
})

describe('the SMS fallback switch', () => {
  it('sends a real JSON boolean, because a string or a number is a 400', async () => {
    const sent = respondWith({ account_id: 'acc-a', sms_fallback_enabled: true })

    const state = await setAccountSmsFallback('acc-a', true)

    expect(sent[0].url).toBe('/accounts/acc-a/sms-fallback')
    expect(JSON.parse(sent[0].data as string)).toEqual({ sms_fallback_enabled: true })
    expect(state).toEqual({ account_id: 'acc-a', sms_fallback_enabled: true })
  })

  it('sends false rather than omitting the field', async () => {
    // An omitted field is a 400 here, so this must not go through any helper
    // that treats a falsy value as absent.
    const sent = respondWith({ account_id: 'acc-a', sms_fallback_enabled: false })

    await setAccountSmsFallback('acc-a', false)

    expect(JSON.parse(sent[0].data as string)).toEqual({ sms_fallback_enabled: false })
  })
})
