import { beforeEach, describe, expect, it } from 'vitest'
import type { AuthUser } from '@/api/auth'
import { NO_PERMISSIONS, PERMISSIONS } from '@/lib/permissions'
import { useAuth } from '@/stores/auth'
import {
  selectHasAllPermissions,
  selectHasAnyPermission,
  selectHasPermission,
  selectPermissions,
} from './use-permissions'

/** Read a selector against the live store, exactly as its hook would. */
const permissions = () => selectPermissions(useAuth.getState())
const has = (p: Parameters<typeof selectHasPermission>[0]) =>
  selectHasPermission(p)(useAuth.getState())
const hasAny = (p: Parameters<typeof selectHasAnyPermission>[0]) =>
  selectHasAnyPermission(p)(useAuth.getState())
const hasAll = (p: Parameters<typeof selectHasAllPermissions>[0]) =>
  selectHasAllPermissions(p)(useAuth.getState())

/**
 * The permission layer is exercised here against the **real** zustand store.
 *
 * That matters: `can.test.tsx` has to mock the store to render anything at all
 * (zustand's server snapshot is `getInitialState()`, so a rendered component
 * cannot observe `setState`), and if this file mocked it too, nothing anywhere
 * would execute the path from the server's `permissions[]` to a decision.
 *
 * What is asserted is each hook's **selector**, read against live state. A hook
 * cannot be called outside a render and there is no renderer here, but the
 * selector is the whole of what these hooks do — `useAuth(selector)` adds a
 * subscription and React's own `Object.is` comparison on the returned snapshot,
 * which is why the identity assertions below are written as identity
 * assertions: they are the exact comparison React would make.
 */

const principal: AuthUser = {
  user_id: 'usr_01',
  username: 'layla',
  account_id: 'acc_01',
  // A composed role whose name this UI has never heard of, on purpose.
  role: 'shift-supervisor',
  roles: ['shift-supervisor'],
  permissions: ['chats.read', 'chats.write'],
  status: 'active',
}

beforeEach(() => {
  useAuth.setState({
    access_token: null,
    refresh_token: null,
    access_token_expires_at: null,
    user: null,
    status: 'unknown',
    endReason: null,
    lastRefresh: null,
  })
})

describe('the store is the source of the permission list (AC-5, AC-8)', () => {
  it('reads permissions[] off the principal the store holds', () => {
    useAuth.setState({ user: principal, status: 'authenticated' })

    expect(permissions()).toEqual(['chats.read', 'chats.write'])
    expect(has(PERMISSIONS.CHATS_WRITE)).toBe(true)
    expect(has(PERMISSIONS.MESSAGES_SEND)).toBe(false)
  })

  it('follows the store when a later /auth/me returns a different list', () => {
    // AC-8: there is no second copy, so a changed principal is a changed
    // answer with nothing to invalidate.
    useAuth.setState({ user: principal, status: 'authenticated' })
    expect(has(PERMISSIONS.CHATS_WRITE)).toBe(true)

    useAuth.setState({ user: { ...principal, permissions: ['chats.read'] } })
    expect(has(PERMISSIONS.CHATS_WRITE)).toBe(false)
  })

  it('decides from the permission list and not from the role name (AC-6, AC-24)', () => {
    // The role is a name no version of this UI knows. The check still passes,
    // because roles are database rows an operator composes (§04).
    useAuth.setState({ user: principal, status: 'authenticated' })
    expect(principal.role).toBe('shift-supervisor')
    expect(has(PERMISSIONS.CHATS_WRITE)).toBe(true)

    // And a privileged-sounding name buys nothing without the permission.
    useAuth.setState({ user: { ...principal, role: 'admin', permissions: [] } })
    expect(has(PERMISSIONS.CHATS_WRITE)).toBe(false)
  })
})

describe('no session means no permissions (AC-13, TC-4)', () => {
  it('returns the empty list and false for every check', () => {
    expect(permissions()).toEqual([])
    expect(has(PERMISSIONS.CHATS_READ)).toBe(false)
    expect(hasAny([PERMISSIONS.CHATS_READ, PERMISSIONS.CHATS_WRITE])).toBe(false)
    expect(hasAll([PERMISSIONS.CHATS_READ])).toBe(false)
  })

  it('is the same frozen reference on every read (TC-15)', () => {
    // A fresh `[]` here would fail Object.is on every snapshot and loop the
    // component. Two reads across an unrelated store write, to make the point.
    const first = permissions()
    useAuth.setState({ status: 'anonymous' })
    const second = permissions()

    expect(first).toBe(NO_PERMISSIONS)
    expect(second).toBe(NO_PERMISSIONS)
    expect(Object.is(first, second)).toBe(true)
  })

  it('survives a principal that arrived without the field at all', () => {
    // isAuthUser() rejects this shape, so it should not reach the store — but
    // "should not" is not "cannot", and the answer must still be false rather
    // than a crash on an undefined array.
    useAuth.setState({ user: { ...principal, permissions: undefined } as unknown as AuthUser })
    expect(has(PERMISSIONS.CHATS_READ)).toBe(false)
    expect(permissions()).toBe(NO_PERMISSIONS)
  })
})

describe('the composites read the same source (AC-10)', () => {
  beforeEach(() => {
    useAuth.setState({ user: principal, status: 'authenticated' })
  })

  it('any-of is true when one is held, all-of false when one is missing', () => {
    expect(hasAny([PERMISSIONS.MESSAGES_SEND, PERMISSIONS.CHATS_READ])).toBe(true)
    expect(hasAll([PERMISSIONS.MESSAGES_SEND, PERMISSIONS.CHATS_READ])).toBe(false)
    expect(hasAll([PERMISSIONS.CHATS_READ, PERMISSIONS.CHATS_WRITE])).toBe(true)
  })
})

describe('selector identity, in both directions (NFR-2, TC-14)', () => {
  it('is stable across a refresh record, which does not touch the principal', () => {
    useAuth.setState({ user: principal, status: 'authenticated' })
    const before = permissions()

    useAuth.getState().recordRefresh('success', 200, null)

    expect(permissions()).toBe(before)
  })

  it('survives a new principal OBJECT that carries the same array', () => {
    // Worth pinning down, because it corrects the obvious guess: what the
    // selector returns is `user.permissions`, so replacing `user` with a
    // spread copy changes nothing — the spread copies the array by reference.
    // It is the array's identity that decides, not the principal's.
    useAuth.setState({ user: principal, status: 'authenticated' })
    const before = permissions()

    useAuth.setState({ user: { ...principal } })

    expect(permissions()).toBe(before)
  })

  it('does NOT survive a rotation whose principal was parsed from the wire', () => {
    // Which is the case that actually occurs. storeTokenPair writes
    // `user: pair.user ?? state.user`, and `AuthTokenPair.user` is optional —
    // so a POST /auth/refresh that answers with a principal replaces `user`
    // with one axios built from JSON, whose `permissions` is a brand-new array
    // with identical contents. Every consumer of the array re-renders; the
    // boolean selectors, below, do not.
    useAuth.setState({ user: principal, status: 'authenticated' })
    const before = permissions()

    const fromTheWire = JSON.parse(JSON.stringify(principal)) as AuthUser
    useAuth.setState({ user: fromTheWire })
    const after = permissions()

    expect(after).toEqual(before)
    expect(after).not.toBe(before)
  })

  it('but the boolean selectors are stable across both — build guards on those', () => {
    useAuth.setState({ user: principal, status: 'authenticated' })
    const before = has(PERMISSIONS.CHATS_WRITE)

    useAuth.getState().recordRefresh('success', 200, null)
    useAuth.setState({ user: JSON.parse(JSON.stringify(principal)) as AuthUser })

    // A boolean compares by value, so Object.is holds and no guarded tree
    // re-renders for the session's own housekeeping.
    expect(has(PERMISSIONS.CHATS_WRITE)).toBe(before)
    expect(Object.is(has(PERMISSIONS.CHATS_WRITE), before)).toBe(true)
  })
})
