import { describe, expect, it } from 'vitest'
import { PERMISSIONS } from '@/lib/permissions'
import {
  accountName,
  accountScopeEntry,
  deviceEmptyReason,
  homeSurface,
  isForeignScope,
  MAX_ACCOUNT_NAME,
  mayEnterAccount,
  scopeIsGone,
  shouldLeaveDeletedAccount,
} from '@/lib/surfaces'

/**
 * The permission sets the three seeded principals actually carry (reference
 * §04), written out rather than composed from a helper — the point of these
 * tests is that a decision is taken from a list of grants, so the list is the
 * fixture.
 */
const USER = [
  PERMISSIONS.CHATS_READ,
  PERMISSIONS.MESSAGES_READ,
  PERMISSIONS.MESSAGES_MARK,
  PERMISSIONS.DEVICES_READ,
  PERMISSIONS.DEVICES_CREATE,
  PERMISSIONS.DEVICES_PAIR,
  PERMISSIONS.CONTACTS_READ,
  PERMISSIONS.GROUPS_READ,
  PERMISSIONS.NEWSLETTERS_READ,
]
const ADMIN = [...USER, PERMISSIONS.ACCOUNTS_MANAGE, PERMISSIONS.USERS_MANAGE]
const SUPER_ADMIN = [...ADMIN, PERMISSIONS.ACCOUNTS_MANAGE_ALL, PERMISSIONS.USERS_MANAGE_ALL]

describe('homeSurface (AC-1, AC-2, AC-20)', () => {
  it('the global permission wins over the narrower one it implies', () => {
    // The test that had to be written first. A super_admin holds BOTH, so a
    // function checking accounts.manage first is wrong in a way that no
    // one-permission-at-a-time test can see: it would answer 'account' here and
    // the platform surface would be unreachable by anybody.
    expect(homeSurface(SUPER_ADMIN)).toBe('platform')
    expect(homeSurface([PERMISSIONS.ACCOUNTS_MANAGE_ALL, PERMISSIONS.ACCOUNTS_MANAGE])).toBe(
      'platform',
    )
  })

  it('an account administrator lands on the account surface', () => {
    expect(homeSurface(ADMIN)).toBe('account')
    expect(ADMIN).not.toContain(PERMISSIONS.ACCOUNTS_MANAGE_ALL)
  })

  it('an ordinary user lands on the device surface', () => {
    expect(homeSurface(USER)).toBe('device')
  })

  it('an empty session lands on the device surface', () => {
    // null before boot, undefined for a principal with no permissions field,
    // and [] for one whose grants are genuinely empty. All three are the same
    // answer, and it is the least privileged one.
    expect(homeSurface(null)).toBe('device')
    expect(homeSurface(undefined)).toBe('device')
    expect(homeSurface([])).toBe('device')
  })

  it('a composed role nobody has heard of works, because the name is never read', () => {
    // §04's golden rule, as a test: an operator can compose a role without a
    // redeploy. The grants below belong to no seeded role — a partial admin who
    // may manage accounts but not users, and who may not leave their own — and
    // the surface is still derived correctly, because nothing here has a name to
    // compare against.
    const composed = [PERMISSIONS.CHATS_READ, PERMISSIONS.ACCOUNTS_MANAGE]
    expect(homeSurface(composed)).toBe('account')

    // Two roles with nothing in common but the one grant that matters land on
    // the same surface — which is the property a role-name comparison could not
    // have. The negative half of the claim (that this module names no role at
    // all) is asserted in source-policy.test.ts, against the source text.
    const alsoComposed = [PERMISSIONS.CHATWOOT_MANAGE, PERMISSIONS.ACCOUNTS_MANAGE]
    expect(homeSurface(alsoComposed)).toBe(homeSurface(composed))
  })

  it('an unrelated administrative grant does not open an accounts surface', () => {
    expect(homeSurface([PERMISSIONS.USERS_MANAGE, PERMISSIONS.ADMIN_DEBUG_TOGGLE])).toBe('device')
    expect(homeSurface([PERMISSIONS.USERS_MANAGE_ALL])).toBe('device')
  })
})

describe('isForeignScope (AC-15)', () => {
  it('the implicit scope is never foreign', () => {
    expect(isForeignScope(null, 'acc_own')).toBe(false)
    expect(isForeignScope(undefined, 'acc_own')).toBe(false)
  })

  it('a blank scope is read as implicit, not as "the account with no id"', () => {
    // The same rule scopedDeviceFilter applies to the wire value: a blank
    // account_id is NO FILTER, and specifically not the devices that have no
    // account.
    expect(isForeignScope('', 'acc_own')).toBe(false)
    expect(isForeignScope('   ', 'acc_own')).toBe(false)
  })

  it("the principal's own account is not foreign, whitespace included", () => {
    expect(isForeignScope('acc_own', 'acc_own')).toBe(false)
    expect(isForeignScope(' acc_own ', 'acc_own')).toBe(false)
  })

  it('any other account is foreign', () => {
    expect(isForeignScope('acc_customer', 'acc_own')).toBe(true)
    expect(isForeignScope('ACC_OWN', 'acc_own')).toBe(true)
  })

  it('an unknown own account fails loud: an explicit scope is foreign', () => {
    // null is a real render: pre-boot, or a session torn down mid-render. There
    // is nothing to compare against, and "unknown" must not read as "yours" —
    // the cheap error is a bar that should not have been shown.
    expect(isForeignScope('acc_customer', null)).toBe(true)
    expect(isForeignScope('acc_customer', undefined)).toBe(true)
    // '' is the reference's "belongs to no account": it owns nothing, so
    // everything is somebody else's.
    expect(isForeignScope('acc_customer', '')).toBe(true)
  })
})

describe('mayEnterAccount (AC-12a)', () => {
  it('a super administrator may enter any account', () => {
    expect(mayEnterAccount('acc_customer', 'acc_own', true)).toBe(true)
    expect(mayEnterAccount('acc_own', 'acc_own', true)).toBe(true)
  })

  it('an account administrator may enter only their own', () => {
    // The hole this function exists to close: accounts.manage opens the accounts
    // SURFACE, and answering "may you leave your own account" with it let a URL
    // scope an admin into a customer — where GET /devices?account_id= answers
    // 200 with an empty list rather than 403, so it reads as "I have no
    // devices".
    expect(mayEnterAccount('acc_own', 'acc_own', false)).toBe(true)
    expect(mayEnterAccount('acc_customer', 'acc_own', false)).toBe(false)
  })

  it('a principal belonging to no account may enter none', () => {
    expect(mayEnterAccount('acc_customer', '', false)).toBe(false)
    expect(mayEnterAccount('acc_customer', null, false)).toBe(false)
    expect(mayEnterAccount('', '', false)).toBe(false)
  })

  it('a missing or blank route id is refused whatever the principal holds', () => {
    expect(mayEnterAccount(undefined, 'acc_own', true)).toBe(false)
    expect(mayEnterAccount('', 'acc_own', true)).toBe(false)
    expect(mayEnterAccount('   ', 'acc_own', true)).toBe(false)
  })
})

describe('accountScopeEntry (AC-12)', () => {
  it('a foreign account is written as an explicit scope', () => {
    expect(accountScopeEntry('acc_customer', 'acc_own', null, true)).toEqual({ enter: 'acc_customer' })
    expect(accountScopeEntry(' acc_customer ', 'acc_own', null, true)).toEqual({ enter: 'acc_customer' })
  })

  it("the principal's own account is written as the IMPLICIT scope", () => {
    // Same devices either way, but not the same value: the explicit id makes a
    // second devicesKey, so a second cache entry and a second request for bytes
    // already held — and getting there costs a device clear.
    expect(accountScopeEntry('acc_own', 'acc_own', 'acc_customer', false)).toEqual({ enter: null })
  })

  it('nothing is written when the target already is the current scope', () => {
    // The idempotence guard. Without it this re-runs on every mount of the
    // detail page and clears the device — which closes the WebSocket, lets
    // DeviceSwitcher adopt another device, and reopens it.
    expect(accountScopeEntry('acc_customer', 'acc_own', 'acc_customer', true)).toBeNull()
    expect(accountScopeEntry('acc_own', 'acc_own', null, false)).toBeNull()
  })

  it('a blank or missing route id writes nothing', () => {
    expect(accountScopeEntry(undefined, 'acc_own', null, true)).toBeNull()
    expect(accountScopeEntry('', 'acc_own', 'acc_customer', true)).toBeNull()
    expect(accountScopeEntry('   ', 'acc_own', 'acc_customer', true)).toBeNull()
  })

  it('a principal with no account of their own still enters an explicit scope', () => {
    // '' matches nothing, so there is no own-account arm to take. Whether they
    // are allowed here at all is mayEnterAccount's question, not this one.
    expect(accountScopeEntry('acc_customer', '', null, true)).toEqual({ enter: 'acc_customer' })
    expect(accountScopeEntry('acc_customer', null, null, true)).toEqual({ enter: 'acc_customer' })
  })

  it('a principal who may not leave their own account writes nothing, whatever the URL says', () => {
    // The permission lives INSIDE this function rather than beside it. There is
    // no renderer in this test environment, so "the component remembered to
    // check" is not something that can be asserted — making the check an
    // argument turns forgetting it into a compile error instead.
    expect(accountScopeEntry('acc_customer', 'acc_own', null, false)).toBeNull()
    expect(accountScopeEntry('acc_customer', 'acc_own', 'acc_other', false)).toBeNull()
    // …and the same principal still enters their own account normally.
    expect(accountScopeEntry('acc_own', 'acc_own', 'acc_other', false)).toEqual({ enter: null })
  })

  it('it refuses exactly what mayEnterAccount refuses', () => {
    // One rule, two entry points: this decides what to WRITE, mayEnterAccount
    // decides what to RENDER. They may not drift, so the agreement is asserted
    // rather than assumed.
    const cases: [string | undefined, string | null, boolean][] = [
      ['acc_customer', 'acc_own', false],
      ['acc_customer', 'acc_own', true],
      ['acc_own', 'acc_own', false],
      ['acc_customer', '', false],
      ['acc_customer', null, false],
      ['', 'acc_own', true],
      [undefined, 'acc_own', true],
    ]
    for (const [route, own, mayLeave] of cases) {
      if (!mayEnterAccount(route, own, mayLeave)) {
        expect(accountScopeEntry(route, own, 'acc_something', mayLeave)).toBeNull()
      }
    }
  })

  it('"write nothing" and "write the implicit scope" are different answers', () => {
    // Collapsing them would make the second unreachable, and leaving an account
    // is exactly the second.
    expect(accountScopeEntry('', 'acc_own', 'acc_customer', true)).toBeNull()
    expect(accountScopeEntry('acc_own', 'acc_own', 'acc_customer', false)).toEqual({ enter: null })
  })
})

describe('accountName (AC-15a)', () => {
  const accounts = [
    { account_id: 'acc_own', name: 'Our own account' },
    { account_id: 'acc_customer', name: 'Northwind Ltd' },
    { account_id: 'acc_blank', name: '   ' },
  ]

  it('names a known account', () => {
    expect(accountName(accounts, 'acc_customer')).toBe('Northwind Ltd')
  })

  it('answers null for an unknown account, a blank name, and no list at all', () => {
    // null is a real answer, not an error: the list arrives from a request that
    // can be pending, slow or refused, and the bar must already be on screen
    // showing the raw id by then.
    expect(accountName(accounts, 'acc_missing')).toBeNull()
    expect(accountName(accounts, 'acc_blank')).toBeNull()
    expect(accountName(undefined, 'acc_customer')).toBeNull()
    expect(accountName([], 'acc_customer')).toBeNull()
  })

  it('strips bidi overrides and isolates', () => {
    // The attack this exists for: the bar is the one thing telling an operator
    // whose account they are acting inside, so a name that can reorder what is
    // rendered around it is not a cosmetic problem.
    const spoof = [{ account_id: 'a', name: '‮Northwind‬ Ltd' }]
    expect(accountName(spoof, 'a')).toBe('Northwind Ltd')
    const isolated = [{ account_id: 'a', name: '⁦your own account⁩' }]
    expect(accountName(isolated, 'a')).toBe('your own account')
  })

  it('strips zero-width and directional marks, and control characters', () => {
    const hidden = [{ account_id: 'a', name: 'North​wind‎‏' }]
    expect(accountName(hidden, 'a')).toBe('Northwind')
  })

  it('a name made only of stripped characters is nothing, not an empty label', () => {
    const empty = [{ account_id: 'a', name: '‮​⁩' }]
    expect(accountName(empty, 'a')).toBeNull()
  })

  it('caps a long name and marks the truncation', () => {
    const long = [{ account_id: 'a', name: 'N'.repeat(200) }]
    const result = accountName(long, 'a')!
    expect(result).toHaveLength(MAX_ACCOUNT_NAME + 1)
    expect(result.endsWith('…')).toBe(true)
    expect(MAX_ACCOUNT_NAME).toBeLessThan(200)
  })

  it('a name exactly at the cap is not truncated', () => {
    const exact = [{ account_id: 'a', name: 'N'.repeat(MAX_ACCOUNT_NAME) }]
    expect(accountName(exact, 'a')).toBe('N'.repeat(MAX_ACCOUNT_NAME))
  })
})

describe('the lens does not survive the account (z8pmx9mf18, AC-21, TC-9)', () => {
  it('leaves the account that was actually deleted', () => {
    expect(shouldLeaveDeletedAccount('acc-a', 'acc-a', true)).toBe(true)
  })

  it('stays where it is when the account was kept', () => {
    // `account_deleted: false` is the documented partial outcome, not a failure:
    // the account still exists and is still a legitimate place to be standing.
    expect(shouldLeaveDeletedAccount('acc-a', 'acc-a', false)).toBe(false)
  })

  it('stays where it is when a different account was deleted', () => {
    expect(shouldLeaveDeletedAccount('acc-a', 'acc-b', true)).toBe(false)
  })

  it('does nothing when the scope is already implicit', () => {
    // `null` is the implicit scope — the principal's own account, which the
    // server narrows to by itself. There is nothing to leave.
    expect(shouldLeaveDeletedAccount(null, 'acc-a', true)).toBe(false)
  })

  it('normalises both ids, like every other comparison in this module', () => {
    expect(shouldLeaveDeletedAccount(' acc-a ', 'acc-a', true)).toBe(true)
    expect(shouldLeaveDeletedAccount('acc-a', ' acc-a ', true)).toBe(true)
    // A whitespace-only scope is the implicit scope, not "the account named ' '".
    expect(shouldLeaveDeletedAccount('   ', '', true)).toBe(false)
  })
})

describe('a lens naming an account that is gone (z8pmx9mf18, AC-21b, TC-9a)', () => {
  const LIST = [{ account_id: 'acc-a' }, { account_id: 'acc-b' }]

  it('clears a scope a loaded list does not contain', () => {
    // The second tab. The lens persists to localStorage and zustand's persist
    // does not broadcast, so this is how a browser learns that somebody else
    // deleted the account it is standing in.
    expect(scopeIsGone(LIST, 'acc-c')).toBe(true)
  })

  it('leaves a scope the list contains', () => {
    expect(scopeIsGone(LIST, 'acc-b')).toBe(false)
  })

  it('leaves the lens alone while the list is pending or refused', () => {
    // `undefined` is a query that has not answered, one that failed, and one
    // disabled for a principal without accounts.manage. Clearing an operator's
    // scope because a request was slow is a worse bug than the one this fixes.
    expect(scopeIsGone(undefined, 'acc-c')).toBe(false)
  })

  it('leaves the lens alone for an empty list', () => {
    // Indistinguishable from "the list did not really load", and a deployment
    // with zero accounts has nothing this decision could be right about.
    expect(scopeIsGone([], 'acc-c')).toBe(false)
  })

  it('says nothing about the implicit scope', () => {
    expect(scopeIsGone(LIST, null)).toBe(false)
    expect(scopeIsGone(LIST, '   ')).toBe(false)
  })

  it('normalises both sides before comparing', () => {
    expect(scopeIsGone([{ account_id: ' acc-c ' }], 'acc-c')).toBe(false)
    expect(scopeIsGone(LIST, ' acc-a ')).toBe(false)
  })
})

describe('deviceEmptyReason (AC-22, AC-23)', () => {
  it('says "no devices" for a user who belongs to an account', () => {
    expect(deviceEmptyReason('acc-a')).toBe('no-devices')
    expect(deviceEmptyReason(' acc-a ')).toBe('no-devices')
  })

  it('RULE: a blank account_id means the user OWNS NOTHING, never "every account"', () => {
    // The reference is explicit that the empty string "resolves to an EMPTY
    // device set, not to every un-accounted device", and that the system refuses
    // to create a user with a blank account — so this state is an identity that
    // predates the account layer, and "you have no devices yet" is the wrong
    // diagnosis entirely. The message it selects names an administrator and
    // offers no control.
    expect(deviceEmptyReason('')).toBe('no-account')
  })

  it('reads whitespace as blank, as every other id in this module does', () => {
    expect(deviceEmptyReason('   ')).toBe('no-account')
    expect(deviceEmptyReason('\t\n')).toBe('no-account')
  })

  it('reads an absent principal as having no account', () => {
    // Pre-boot and mid-teardown. There is no account to name, and offering to
    // add a device to it would be the wrong invitation either way.
    expect(deviceEmptyReason(null)).toBe('no-account')
    expect(deviceEmptyReason(undefined)).toBe('no-account')
  })
})
