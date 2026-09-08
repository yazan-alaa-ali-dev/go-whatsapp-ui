import { describe, expect, it } from 'vitest'
import { NAV_GROUPS, SURFACE_PERMISSIONS, visibleNavGroups } from '@/components/layout/navigation'
import { PERMISSIONS } from '@/lib/permissions'

const paths = (granted: readonly string[] | null | undefined) =>
  visibleNavGroups(granted).flatMap((group) => group.items.map((item) => item.to))

const labels = (granted: readonly string[] | null | undefined) =>
  visibleNavGroups(granted).map((group) => group.label)

/** The routes every signed-in principal reaches, whatever they hold. */
const OPERATIONAL = ['/', '/messaging', '/chats', '/groups', '/account', '/misc', '/settings']

const ADMIN = [PERMISSIONS.ACCOUNTS_MANAGE, PERMISSIONS.USERS_MANAGE]
const SUPER_ADMIN = [...ADMIN, PERMISSIONS.ACCOUNTS_MANAGE_ALL, PERMISSIONS.USERS_MANAGE_ALL]

describe('visibleNavGroups (AC-6, AC-7, AC-9)', () => {
  it('an ordinary user sees the operational entries and nothing administrative', () => {
    // AC-9: absent, not disabled. The assertion is on the whole list rather than
    // on the two administrative paths, because "not in the list" is the claim —
    // a disabled entry would still be here.
    expect(paths([PERMISSIONS.CHATS_READ, PERMISSIONS.DEVICES_READ])).toEqual(OPERATIONAL)
    expect(labels([PERMISSIONS.CHATS_READ])).not.toContain('Administration')
  })

  it('an empty session sees the operational entries only', () => {
    expect(paths(null)).toEqual(OPERATIONAL)
    expect(paths(undefined)).toEqual(OPERATIONAL)
    expect(paths([])).toEqual(OPERATIONAL)
  })

  it('accounts.manage — NOT accounts.manage.all — is what shows the Accounts entry', () => {
    // The study (§05) names this as the mistake to expect: gate the accounts
    // SURFACE on the global permission and it disappears for every account
    // administrator, who is its primary audience.
    expect(paths([PERMISSIONS.ACCOUNTS_MANAGE])).toContain('/accounts')
    expect(SURFACE_PERMISSIONS.accounts).toBe(PERMISSIONS.ACCOUNTS_MANAGE)
    expect(SURFACE_PERMISSIONS.accounts).not.toBe(PERMISSIONS.ACCOUNTS_MANAGE_ALL)
  })

  it('the global permission alone opens no surface', () => {
    // A shape the seeded roles never produce — a super_admin holds both — but a
    // composed role could. The surface is gated on .manage and the entry is
    // absent without it; widening the gate to "either" would invent authority
    // the catalogue does not grant.
    expect(paths([PERMISSIONS.ACCOUNTS_MANAGE_ALL])).toEqual(OPERATIONAL)
  })

  it('users.manage shows the Users entry, on its own', () => {
    expect(paths([PERMISSIONS.USERS_MANAGE])).toContain('/users')
    expect(paths([PERMISSIONS.USERS_MANAGE])).not.toContain('/accounts')
    expect(labels([PERMISSIONS.USERS_MANAGE])).toContain('Administration')
  })

  it('the two administrative entries are independent', () => {
    expect(paths([PERMISSIONS.ACCOUNTS_MANAGE])).not.toContain('/users')
    expect(paths(ADMIN)).toContain('/accounts')
    expect(paths(ADMIN)).toContain('/users')
  })

  it('a super administrator sees everything, and nothing twice', () => {
    const all = paths(SUPER_ADMIN)
    expect(all).toEqual([...OPERATIONAL.slice(0, 5), '/accounts', '/users', ...OPERATIONAL.slice(5)])
    expect(new Set(all).size).toBe(all.length)
  })

  it('a group emptied by the filter is dropped, not rendered as a bare heading', () => {
    const groups = visibleNavGroups([PERMISSIONS.CHATS_READ])
    expect(groups.every((group) => group.items.length > 0)).toBe(true)
    expect(groups.map((g) => g.label)).toEqual(['Overview', 'Messaging', 'Directory', 'System'])
  })

  it('the operational entries are never gated', () => {
    // NFR-1: nothing an existing principal can do changes. An unguarded item is
    // one with no `permission` at all, which is a stronger statement than
    // "visible for this fixture".
    const ungated = NAV_GROUPS.flatMap((group) => group.items).filter(
      (item) => item.permission === undefined,
    )
    expect(ungated.map((item) => item.to)).toEqual(OPERATIONAL)
  })

  it('no entry carries a disabled flag, because there is nowhere to put one', () => {
    for (const item of NAV_GROUPS.flatMap((group) => group.items)) {
      expect(Object.keys(item).sort()).toEqual(
        item.permission === undefined
          ? ['icon', 'label', 'to']
          : ['icon', 'label', 'permission', 'to'],
      )
    }
  })

  it('the filter copies, so the table it reads is not mutated', () => {
    const before = NAV_GROUPS.flatMap((group) => group.items.map((item) => item.to))
    visibleNavGroups([])
    visibleNavGroups(SUPER_ADMIN)
    expect(NAV_GROUPS.flatMap((group) => group.items.map((item) => item.to))).toEqual(before)
  })

  it('the two surface gates are the ones the route guard reads', () => {
    // The declaration src/App.tsx imports. If this changes, the route guard
    // changes with it — which is the point of there being one constant.
    expect(SURFACE_PERMISSIONS).toEqual({
      accounts: PERMISSIONS.ACCOUNTS_MANAGE,
      users: PERMISSIONS.USERS_MANAGE,
    })
  })

  it('every item has an icon and a distinct path', () => {
    const items = NAV_GROUPS.flatMap((group) => group.items)
    expect(items.every((item) => typeof item.icon === 'function' || typeof item.icon === 'object'))
      .toBe(true)
    expect(new Set(items.map((item) => item.to)).size).toBe(items.length)
  })
})
