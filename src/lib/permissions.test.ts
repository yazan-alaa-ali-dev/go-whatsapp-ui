import { describe, expect, it } from 'vitest'
import {
  ALL_PERMISSIONS,
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  NO_PERMISSIONS,
  PERMISSIONS,
  type Permission,
} from './permissions'

/**
 * The reference's §04 catalogue, written out here independently of the module
 * under test so that the comparison is worth making. Twenty-four of these are
 * transcribed literally from the table; four — `contacts.write`,
 * `groups.write`, `newsletters.write`, `devices.webhook.write` — are the
 * expansion of a `.read / .write` shorthand the table uses and never spells
 * out. That distinction is recorded as a known limit in `spec.md`.
 */
const REFERENCE_CATALOGUE = [
  'chats.read',
  'chats.write',
  'messages.read',
  'messages.mark',
  'messages.send',
  'messages.debug.read',
  'messages.transcript.read',
  'messages.origin.read',
  'devices.read',
  'devices.create',
  'devices.pair',
  'devices.delete',
  'devices.webhook.read',
  'devices.webhook.write',
  'contacts.read',
  'contacts.write',
  'groups.read',
  'groups.write',
  'newsletters.read',
  'newsletters.write',
  'calls.reject',
  'accounts.manage',
  'users.manage',
  'chatwoot.manage',
  'admin.debug.toggle',
  'admin.retention.run',
  'accounts.manage.all',
  'users.manage.all',
]

describe('the catalogue (AC-1, AC-2, TC-12)', () => {
  it('carries every name the reference §04 table lists, and no other', () => {
    expect([...ALL_PERMISSIONS].sort()).toEqual([...REFERENCE_CATALOGUE].sort())
  })

  it('has 28 names, each spelled as the wire format spells it', () => {
    expect(ALL_PERMISSIONS).toHaveLength(28)
    // Lower case, dot-separated segments — the wire format's own shape. A
    // SCREAMING_SNAKE value would mean a key had been pasted over a value.
    for (const permission of ALL_PERMISSIONS) {
      expect(permission).toMatch(/^[a-z]+(?:\.[a-z]+)+$/)
    }
  })

  it('keeps the two global permissions distinct from their account-scoped pair', () => {
    // The distinction an `admin` lives on: it holds the first of each pair and
    // not the second, so gating a *surface* on the `.all` form hides that
    // surface from every admin (§04).
    expect(PERMISSIONS.ACCOUNTS_MANAGE).not.toBe(PERMISSIONS.ACCOUNTS_MANAGE_ALL)
    expect(PERMISSIONS.USERS_MANAGE).not.toBe(PERMISSIONS.USERS_MANAGE_ALL)
    expect(PERMISSIONS.ACCOUNTS_MANAGE_ALL.startsWith(PERMISSIONS.ACCOUNTS_MANAGE)).toBe(true)
  })

  it('has no duplicate value', () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length)
  })
})

describe('hasPermission (AC-9, AC-13, TC-1, TC-4)', () => {
  it('is true when the principal holds it (TC-1)', () => {
    expect(hasPermission(['chats.read', 'messages.send'], PERMISSIONS.MESSAGES_SEND)).toBe(true)
  })

  it('is false when the principal does not (TC-2)', () => {
    // The nine a seeded `user` role actually holds — no messages.send.
    const userRole = [
      'chats.read',
      'messages.read',
      'messages.mark',
      'devices.read',
      'devices.create',
      'devices.pair',
      'contacts.read',
      'groups.read',
      'newsletters.read',
    ]
    expect(hasPermission(userRole, PERMISSIONS.MESSAGES_SEND)).toBe(false)
  })

  it('is false, not a crash, with no session at all (TC-4)', () => {
    // The three shapes "whatever the store holds" takes before boot, after a
    // sign-out, and when a principal arrived without the field.
    expect(hasPermission(null, PERMISSIONS.CHATS_READ)).toBe(false)
    expect(hasPermission(undefined, PERMISSIONS.CHATS_READ)).toBe(false)
    expect(hasPermission(NO_PERMISSIONS, PERMISSIONS.CHATS_READ)).toBe(false)
  })

  it('matches the whole name, never a prefix', () => {
    // `accounts.manage` must not answer for `accounts.manage.all`. Anything
    // built on startsWith would give a plain admin the super_admin's surface.
    expect(hasPermission(['accounts.manage'], PERMISSIONS.ACCOUNTS_MANAGE_ALL)).toBe(false)
    expect(hasPermission(['accounts.manage.all'], PERMISSIONS.ACCOUNTS_MANAGE)).toBe(false)
  })
})

describe('the role name has no effect on the answer (AC-6, AC-24, TC-3)', () => {
  it('grants a composed role whatever its permissions list says', () => {
    // A role an operator composed after this UI shipped: the name is not one
    // the UI has ever heard of, and it does not matter. Roles are database rows
    // (§04) — the permission list is the only thing that decides.
    const principal = { role: 'shift-supervisor', roles: ['shift-supervisor'] }
    const granted = ['chats.read', 'chats.write']

    expect(hasPermission(granted, PERMISSIONS.CHATS_WRITE)).toBe(true)
    // Stated rather than implied: nothing above consulted `principal`.
    expect(principal.role).not.toBe('admin')
  })

  it('refuses an admin-named role that does not hold the permission', () => {
    // The mirror image, and the one that actually matters: a name that sounds
    // privileged buys nothing. `src/lib/source-policy.test.ts` is what proves
    // no shipped file consults the name at all.
    expect(hasPermission([], PERMISSIONS.ACCOUNTS_MANAGE)).toBe(false)
    expect(hasPermission(['chats.read'], PERMISSIONS.USERS_MANAGE)).toBe(false)
  })
})

describe('the composite checks (AC-10, TC-5, TC-6)', () => {
  const granted = ['chats.read']

  it('any-of is true when one of them is held (TC-5)', () => {
    expect(hasAnyPermission(granted, [PERMISSIONS.CHATS_WRITE, PERMISSIONS.CHATS_READ])).toBe(true)
  })

  it('all-of is false when one of them is missing (TC-5)', () => {
    expect(hasAllPermissions(granted, [PERMISSIONS.CHATS_WRITE, PERMISSIONS.CHATS_READ])).toBe(
      false,
    )
  })

  it('all-of is true when every one is held', () => {
    expect(hasAllPermissions(['chats.read', 'chats.write'], [PERMISSIONS.CHATS_READ])).toBe(true)
  })

  it('answers an empty list deliberately: any is false, all is true (TC-6)', () => {
    // Array.prototype's own answers, and the right ones — an empty requirement
    // demands nothing. Asserted so a rewrite that loops by hand cannot quietly
    // flip them; `all []` is the one a hand-written loop gets wrong.
    const empty: Permission[] = []
    expect(hasAnyPermission(granted, empty)).toBe(false)
    expect(hasAllPermissions(granted, empty)).toBe(true)
    expect(hasAnyPermission(null, empty)).toBe(false)
    expect(hasAllPermissions(null, empty)).toBe(true)
  })

  it('is false for any-of with no session (AC-13)', () => {
    expect(hasAnyPermission(null, [PERMISSIONS.CHATS_READ, PERMISSIONS.CHATS_WRITE])).toBe(false)
    expect(hasAllPermissions(null, [PERMISSIONS.CHATS_READ])).toBe(false)
  })
})

describe('NO_PERMISSIONS (NFR-2)', () => {
  it('is empty, frozen, and the same reference every time it is read', () => {
    // The identity is the point: two reads must satisfy Object.is, or a
    // zustand selector returning it re-renders forever.
    expect(NO_PERMISSIONS).toHaveLength(0)
    expect(Object.isFrozen(NO_PERMISSIONS)).toBe(true)
    expect(NO_PERMISSIONS).toBe(NO_PERMISSIONS)
  })
})
