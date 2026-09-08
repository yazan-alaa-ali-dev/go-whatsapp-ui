import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { accountDevicesKey, accountsKey, devicesKey, usersKey } from './query-keys'

/**
 * The cache behaviour these keys exist to produce, asserted against a real
 * `QueryClient` rather than against the shape of an array. The query core runs
 * in node with no renderer, so the two properties that matter — separation and
 * prefix invalidation — are both directly observable.
 */

describe('the scope is part of the key (AC-11, TC-9)', () => {
  it('carries the effective account filter', () => {
    expect(devicesKey(null)).toEqual(['devices', null])
    expect(devicesKey('acc-a')).toEqual(['devices', 'acc-a'])
  })

  it('never serves one account’s devices for another', () => {
    const client = new QueryClient()
    client.setQueryData(devicesKey('acc-a'), [{ id: 'dev-of-a' }])

    expect(client.getQueryData(devicesKey('acc-b'))).toBeUndefined()
    expect(client.getQueryData(devicesKey(null))).toBeUndefined()
    expect(client.getQueryData(devicesKey('acc-a'))).toEqual([{ id: 'dev-of-a' }])
  })

  it('does not collide with the account-devices key, which answers a different question', () => {
    // The registry list carries live connection state; the account list is the
    // authoritative membership. Same account, two facts, two keys.
    const client = new QueryClient()
    client.setQueryData(devicesKey('acc-a'), ['registry'])
    client.setQueryData(accountDevicesKey('acc-a'), ['rows'])

    expect(client.getQueryData(devicesKey('acc-a'))).toEqual(['registry'])
    expect(client.getQueryData(accountDevicesKey('acc-a'))).toEqual(['rows'])
  })
})

describe('the bare prefix still invalidates every scope (AC-13, TC-10)', () => {
  /**
   * Six places in this app invalidate `['devices']` with no second element —
   * `App.tsx`'s WebSocket switch, both session login dialogs, the push-name
   * form, the create-device dialog and the device card. None of them is edited
   * by this ticket, so what they all rely on is asserted here once: TanStack
   * matches a query key partially.
   */
  it('marks a scoped query stale from the unscoped prefix', async () => {
    const client = new QueryClient()
    client.setQueryData(devicesKey('acc-a'), ['stale-soon'])
    client.setQueryData(devicesKey(null), ['also-stale-soon'])
    expect(client.getQueryState(devicesKey('acc-a'))?.isInvalidated).toBe(false)

    await client.invalidateQueries({ queryKey: ['devices'] })

    expect(client.getQueryState(devicesKey('acc-a'))?.isInvalidated).toBe(true)
    expect(client.getQueryState(devicesKey(null))?.isInvalidated).toBe(true)
  })

  it('does not reach past its own prefix', async () => {
    const client = new QueryClient()
    client.setQueryData(accountsKey(), ['untouched'])
    client.setQueryData(devicesKey('acc-a'), ['stale-soon'])

    await client.invalidateQueries({ queryKey: ['devices'] })

    expect(client.getQueryState(accountsKey())?.isInvalidated).toBe(false)
    expect(client.getQueryState(devicesKey('acc-a'))?.isInvalidated).toBe(true)
  })
})

describe('the keys the later surfaces will use (AC-12)', () => {
  it('names each list separately', () => {
    expect(accountsKey()).toEqual(['accounts'])
    expect(accountDevicesKey('acc-a')).toEqual(['account-devices', 'acc-a'])
    expect(usersKey({ limit: 100, offset: 0 })).toEqual(['users', { limit: 100, offset: 0 }])
  })

  it('hashes a paged user key by value, so a fresh literal is the same entry', () => {
    // An object in a key is safe here — TanStack hashes with JSON.stringify and
    // sorted object keys — and it matches the precedent in chat-list.tsx.
    const client = new QueryClient()
    client.setQueryData(usersKey({ limit: 100, offset: 0 }), ['page-one'])

    expect(client.getQueryData(usersKey({ limit: 100, offset: 0 }))).toEqual(['page-one'])
    expect(client.getQueryData(usersKey({ limit: 100, offset: 100 }))).toBeUndefined()
  })

  it('leaves the users list reachable by its own bare prefix', async () => {
    const client = new QueryClient()
    client.setQueryData(usersKey({ limit: 100, offset: 0 }), ['page-one'])
    client.setQueryData(usersKey({ limit: 100, offset: 100 }), ['page-two'])

    await client.invalidateQueries({ queryKey: ['users'] })

    expect(client.getQueryState(usersKey({ limit: 100, offset: 0 }))?.isInvalidated).toBe(true)
    expect(client.getQueryState(usersKey({ limit: 100, offset: 100 }))?.isInvalidated).toBe(true)
  })
})
