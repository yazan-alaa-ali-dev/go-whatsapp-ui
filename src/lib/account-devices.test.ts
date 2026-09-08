import { AxiosError } from 'axios'
import { describe, expect, it } from 'vitest'
import type { AccountDevice } from '@/api/accounts'
import type { RegistryDevice } from '@/api/types'
import {
  MAX_ORDER_ENTRIES,
  connectionOf,
  createdWithoutAccount,
  deviceRejection,
  joinAccountDevices,
  orderSubmission,
  toggledSendState,
} from './account-devices'

/**
 * The decisions the account devices surface makes, asserted where a renderer
 * cannot reach them.
 *
 * Two of these are the ticket: a row the registry did not load must not read as
 * `disconnected`, and an order payload must carry the complete set. Both fail
 * silently in production — the first as a wrong badge, the second as a `400`
 * nothing on screen explains — so both are asserted here rather than reviewed.
 */

function row(device_id: string, extra: Partial<AccountDevice> = {}): AccountDevice {
  return {
    device_id,
    jid: `${device_id}@s.whatsapp.net`,
    transport: 'whatsmeow',
    priority: 100,
    send_state: '',
    ...extra,
  }
}

function registryDevice(id: string, extra: Partial<RegistryDevice> = {}): RegistryDevice {
  return { id, state: 'logged_in', created_at: '2026-01-14T09:12:00Z', ...extra }
}

function rejection(status: number): AxiosError {
  return new AxiosError('failed', 'ERR', undefined, undefined, {
    status,
    data: { code: String(status), message: '', results: null },
    statusText: '',
    headers: {},
    // The adapter config is irrelevant to toApiError; only status and data are read.
    config: { headers: {} },
  } as never)
}

describe('the two sources are joined left, on the rows', () => {
  it('lists exactly the rows, in the order the row endpoint returned them', () => {
    const joined = joinAccountDevices([row('b'), row('a'), row('c')], [])
    expect(joined.map((entry) => entry.row.device_id)).toEqual(['b', 'a', 'c'])
    expect(joined.map((entry) => entry.position)).toEqual([1, 2, 3])
  })

  it('keeps a row the registry did not load, and leaves its registry entry undefined', () => {
    // TC-1. The device belongs to the account and will be tried in the reply
    // path; the registry simply has nothing to say about it.
    const joined = joinAccountDevices(
      [row('loaded'), row('not-loaded')],
      [registryDevice('loaded')],
    )
    expect(joined).toHaveLength(2)
    expect(joined[1].row.device_id).toBe('not-loaded')
    expect(joined[1].registry).toBeUndefined()
  })

  it('does not invent a membership row out of a registry entry', () => {
    // TC-2. The right join is the bug: it drops devices that exist and then the
    // order endpoint refuses the incomplete list it produces.
    const joined = joinAccountDevices([row('a')], [registryDevice('a'), registryDevice('stranger')])
    expect(joined.map((entry) => entry.row.device_id)).toEqual(['a'])
  })

  it('takes membership fields from the row and live fields from the registry', () => {
    // TC-3. The two sources answer different questions and neither may be read
    // for the other's fields.
    const [joined] = joinAccountDevices(
      [row('a', { priority: 10, send_state: 'blocked' })],
      [registryDevice('a', { state: 'connecting', display_name: 'Acme Support' })],
    )
    expect(joined.row.priority).toBe(10)
    expect(joined.row.send_state).toBe('blocked')
    expect(joined.registry?.state).toBe('connecting')
    expect(joined.registry?.display_name).toBe('Acme Support')
  })

  it('reads an in-flight query as a list where nothing is loaded, not as an error', () => {
    expect(joinAccountDevices(undefined, undefined)).toEqual([])
    const joined = joinAccountDevices([row('a')], undefined)
    expect(joined[0].registry).toBeUndefined()
  })
})

describe('an unloaded device is unknown, never disconnected', () => {
  it('answers unknown when the registry has no entry', () => {
    // The single most consequential line on this screen: `disconnected` is a
    // fact about a loaded device, and reporting an absence as that fact is what
    // makes an operator re-pair a device that was fine.
    expect(connectionOf(undefined)).toBe('unknown')
    expect(connectionOf(undefined)).not.toBe('disconnected')
  })

  it('passes through the state the registry actually reported', () => {
    expect(connectionOf(registryDevice('a', { state: 'disconnected' }))).toBe('disconnected')
    expect(connectionOf(registryDevice('a', { state: 'logged_in' }))).toBe('logged_in')
  })
})

describe('the order payload is the complete set', () => {
  it('carries every device of the account, once each, in the new order', () => {
    const result = orderSubmission([row('a'), row('b'), row('c')], 'c', 'up')
    expect(result).toEqual({ kind: 'submit', order: ['a', 'c', 'b'] })
  })

  it('includes a device the registry did not load', () => {
    // TC-4, and the reason `orderSubmission` takes the ROW array rather than a
    // list of ids: a list built from the registry would be missing this device,
    // would type-check, and would be refused with a 400 the operator cannot
    // diagnose.
    const rows = [row('a'), row('not-loaded'), row('c')]
    const result = orderSubmission(rows, 'a', 'down')
    expect(result).toEqual({ kind: 'submit', order: ['not-loaded', 'a', 'c'] })
    if (result.kind !== 'submit') throw new Error('unreachable')
    expect(result.order).toContain('not-loaded')
    expect(new Set(result.order).size).toBe(result.order.length)
    expect(result.order).toHaveLength(rows.length)
  })

  it('does nothing at either end of the list', () => {
    expect(orderSubmission([row('a'), row('b')], 'a', 'up')).toEqual({ kind: 'noop' })
    expect(orderSubmission([row('a'), row('b')], 'b', 'down')).toEqual({ kind: 'noop' })
  })

  it('does nothing for a device that is not in the set', () => {
    expect(orderSubmission([row('a')], 'stranger', 'up')).toEqual({ kind: 'noop' })
    expect(orderSubmission(undefined, 'a', 'up')).toEqual({ kind: 'noop' })
  })

  it('refuses rather than submits above the endpoint’s limit', () => {
    // TC-6. The ceiling is the endpoint's, and meeting it as a 400 after a move
    // would read as a broken control rather than as a documented limit.
    const tooMany = Array.from({ length: MAX_ORDER_ENTRIES + 1 }, (_, index) => row(`d${index}`))
    const result = orderSubmission(tooMany, 'd5', 'up')
    expect(result.kind).toBe('refused')
    if (result.kind !== 'refused') throw new Error('unreachable')
    expect(result.reason).toContain(String(MAX_ORDER_ENTRIES))
  })

  it('submits at exactly the limit', () => {
    const exactly = Array.from({ length: MAX_ORDER_ENTRIES }, (_, index) => row(`d${index}`))
    expect(orderSubmission(exactly, 'd5', 'up').kind).toBe('submit')
  })
})

describe('unblocking sends the empty string', () => {
  it('turns a blocked device usable with an empty send state', () => {
    // TC-7. The empty string is the only way to clear the flag, which is why
    // `src/api/accounts.ts` refuses the payload-cleaning helper module-wide.
    expect(toggledSendState('blocked')).toBe('')
  })

  it('blocks a usable device', () => {
    expect(toggledSendState('')).toBe('blocked')
  })
})

describe('a device created into no account is reported, and only when it is knowable', () => {
  it('reports a device whose account_id came back present and blank', () => {
    expect(createdWithoutAccount(registryDevice('a', { account_id: '' }))).toBe(true)
  })

  it('says nothing when the field is absent, because that is about the caller', () => {
    // The seeded `user` role holds devices.create and not accounts.manage, so
    // the field is absent on every create it makes. `=== ''` would warn all of
    // them, every time, about a condition nobody observed.
    expect(createdWithoutAccount(registryDevice('a'))).toBe(false)
  })

  it('says nothing when the device belongs to an account', () => {
    expect(createdWithoutAccount(registryDevice('a', { account_id: 'acc-a' }))).toBe(false)
  })
})

describe('a device rejection never becomes a statement about permission', () => {
  it('reads a 404 as "not available" for every operation but create', () => {
    // TC-12. The backend answers 404 identically for a device that does not
    // exist and one belonging to another account, on purpose. Guessing which
    // hands back the oracle it withheld.
    for (const operation of ['attach', 'order', 'send-state', 'delete'] as const) {
      expect(deviceRejection(rejection(404), operation)).toBe('device-not-available')
    }
  })

  it('reads a 404 on create as the account, because the device does not exist yet', () => {
    expect(deviceRejection(rejection(404), 'create')).toBe('account-not-found')
  })

  it('separates the two 409s by the request that produced them', () => {
    // No status code distinguishes these; only the caller knows which it sent.
    expect(deviceRejection(rejection(409), 'create')).toBe('device-id-taken')
    expect(deviceRejection(rejection(409), 'attach')).toBe('device-belongs-elsewhere')
  })

  it('reads a 400 on the order endpoint as a refused list', () => {
    expect(deviceRejection(rejection(400), 'order')).toBe('device-order-refused')
    expect(deviceRejection(rejection(400), 'send-state')).toBeNull()
  })

  it('falls through on a 403, which is a real permission refusal and not the 404 oracle', () => {
    // toActionErrorMessage renders it while keeping the server's text, spending
    // no refresh and triggering no logout. Nothing here re-implements that.
    for (const operation of ['create', 'attach', 'order', 'send-state', 'delete'] as const) {
      expect(deviceRejection(rejection(403), operation)).toBeNull()
    }
  })

  it('falls through on anything unrecognised', () => {
    expect(deviceRejection(rejection(500), 'delete')).toBeNull()
    expect(deviceRejection(new Error('offline'), 'delete')).toBeNull()
  })
})
