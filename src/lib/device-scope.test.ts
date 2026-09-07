import {
  AxiosError,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listDevices } from '@/api/devices'
import type { RegistryDevice } from '@/api/types'
import { useAuth } from '@/stores/auth'
import { useDeviceStore } from '@/stores/device'
import { http } from './http'
import { hasScopedField, scopedDeviceFilter } from './device-scope'

describe('the filter is gated on the permission (AC-7, TC-4, TC-5)', () => {
  it('is dropped entirely without the permission', () => {
    // Right under both readings of the reference. If `accounts.manage` is a
    // deployment precondition, the filter answers 503 and the UI would have
    // manufactured a broken-server message. If it is the caller's grant, such a
    // caller already sees only their own account's devices and the parameter
    // "can only NARROW that set" — so it buys nothing and can only mislead.
    expect(scopedDeviceFilter('acc-b', false)).toBeNull()
  })

  it('is sent with the permission and an explicit scope', () => {
    expect(scopedDeviceFilter('acc-b', true)).toBe('acc-b')
  })

  it('is dropped for the implicit scope even with the permission', () => {
    expect(scopedDeviceFilter(null, true)).toBeNull()
    expect(scopedDeviceFilter(undefined, true)).toBeNull()
  })
})

describe('a blank is no filter, and never "the devices with no account" (AC-8, TC-6)', () => {
  it('never sends an empty string', () => {
    expect(scopedDeviceFilter('', true)).toBeNull()
  })

  it('treats whitespace as blank rather than as a malformed id', () => {
    expect(scopedDeviceFilter('   ', true)).toBeNull()
    expect(scopedDeviceFilter('\t\n', true)).toBeNull()
  })

  it('trims a value it does send, so padding is not a 400', () => {
    expect(scopedDeviceFilter('  acc-b  ', true)).toBe('acc-b')
  })

  it('does not treat a malformed id as blank — that 400 belongs to the server', () => {
    // AC-9 lives or dies here: swallowing a malformed id into "no filter" would
    // silently answer with the whole implicit list instead of an error.
    expect(scopedDeviceFilter('not a valid id!!', true)).toBe('not a valid id!!')
  })
})

describe('the three privileged fields are read by presence (AC-24, AC-25, TC-16)', () => {
  const base: RegistryDevice = {
    id: 'dev-a',
    state: 'logged_in',
    created_at: '2026-01-01T00:00:00Z',
  }

  it('reports absent when the caller was not allowed to see the field', () => {
    expect(hasScopedField(base, 'account_id')).toBe(false)
    expect(hasScopedField(base, 'priority')).toBe(false)
    expect(hasScopedField(base, 'send_state')).toBe(false)
  })

  it('reports PRESENT for an empty string — "no account" is not "not allowed"', () => {
    // The whole point. `device.account_id === ''` conflates two different
    // facts: the empty string means the device belongs to no account, and an
    // absent key means the caller may not see which account it belongs to.
    const unowned: RegistryDevice = { ...base, account_id: '' }
    expect(hasScopedField(unowned, 'account_id')).toBe(true)
    expect(unowned.account_id).toBe('')
  })

  it('reports present for a zero priority and an empty send state', () => {
    // Falsy values that are real answers: 0 is the highest priority there is,
    // and '' is the usable send state.
    const device: RegistryDevice = { ...base, priority: 0, send_state: '' }
    expect(hasScopedField(device, 'priority')).toBe(true)
    expect(hasScopedField(device, 'send_state')).toBe(true)
  })

  it('reports present for a key explicitly holding undefined', () => {
    // A key that is there is there. Rewriting this as `device[field] !== undefined`
    // would answer "absent" for a payload that carries the key, which is the
    // one thing the §09-style presence rule may not get wrong.
    const device = { ...base, account_id: undefined } as unknown as RegistryDevice
    expect(hasScopedField(device, 'account_id')).toBe(true)
  })
})

/**
 * What the filter does to the request itself, through the real interceptor
 * chain and a stub adapter — the same harness `http.test.ts` uses.
 */
describe('the filter on the wire (AC-6, AC-8, AC-9, AC-10, TC-7, TC-8)', () => {
  const originalAdapter = http.defaults.adapter

  function respondWith(status: number, results: unknown): InternalAxiosRequestConfig[] {
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

  it('sends no account_id parameter for the implicit scope', async () => {
    const sent = respondWith(200, [])

    await listDevices(scopedDeviceFilter(null, true))

    expect(sent[0].params).toBeUndefined()
  })

  it('sends no account_id parameter for a principal without the permission', async () => {
    const sent = respondWith(200, [])

    await listDevices(scopedDeviceFilter('acc-b', false))

    expect(sent[0].params).toBeUndefined()
  })

  it('sends the account_id parameter for an explicit scope', async () => {
    const sent = respondWith(200, [])

    await listDevices(scopedDeviceFilter('acc-b', true))

    expect(sent[0].params).toEqual({ account_id: 'acc-b' })
  })

  it('an empty list for a foreign account resolves as empty, not as an error', async () => {
    // TC-7. The backend answers a foreign account with 200 and [] deliberately,
    // so the response cannot be used to discover which accounts exist. Nothing
    // here may turn that into an error, and nothing may read it as proof the
    // account is real.
    respondWith(200, [])

    await expect(listDevices('acc-foreign')).resolves.toEqual([])
  })

  it('a 400 rejects, so it is a different state from the empty list', async () => {
    // TC-8. The two states must stay distinguishable: TanStack surfaces one as
    // `data: []` and the other as `error`.
    respondWith(400, null)

    await expect(listDevices('malformed!!')).rejects.toMatchObject({ status: 400 })
  })

  it('an empty envelope on a 2xx is [] — the ?? never absorbs a rejection', async () => {
    respondWith(200, undefined)

    await expect(listDevices(null)).resolves.toEqual([])
  })
})
