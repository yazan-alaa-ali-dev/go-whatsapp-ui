import { AxiosError } from 'axios'
import { describe, expect, it } from 'vitest'
import type { AdminUser } from '@/api/users'
import {
  collisionDetail,
  createUserPayloadFrom,
  DEFAULT_PAGE_SIZE,
  editableFrom,
  emailError,
  filterByAccount,
  isEmptyUpdate,
  isSelf,
  mayRemoveAdministration,
  MAX_PAGE_SIZE,
  normaliseUsername,
  notFoundDetail,
  pageState,
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_BYTES,
  passwordByteLength,
  passwordError,
  passwordFailure,
  assignableRoles,
  GLOBALLY_SCOPED_ROLES,
  SEEDED_ROLES,
  updatePayloadFrom,
  usernameError,
  userRejection,
  type CreateUserFields,
  type EditableUser,
} from '@/lib/user-admin'

/**
 * A real `AxiosError`, because that is what `toApiError` branches on first.
 *
 * The same helper `account-devices.test.ts` uses. A plain object with a
 * `response` key looks convincing and takes the `UNKNOWN` / `status: 0` path
 * instead, which would make every rejection here read as a transport failure.
 */
function httpError(status: number, message = 'refused'): AxiosError {
  return new AxiosError('failed', 'ERR', undefined, undefined, {
    status,
    data: { code: String(status), message, results: null },
    statusText: '',
    headers: {},
    config: { headers: {} },
  } as never)
}

const FIELDS: CreateUserFields = {
  username: 'sara',
  password: 'correct-horse',
  email: '',
  roles: [],
  status: 'active',
  arm: 'existing',
  accountId: 'acc_1',
  newAccountId: '',
  newAccountName: '',
}

const ORIGINAL: EditableUser = {
  email: 'sara@acme.com',
  accountId: 'acc_1',
  status: 'active',
  roles: ['admin', 'user'],
}

function user(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    user_id: 'usr_1',
    username: 'sara',
    email: 'sara@acme.com',
    account_id: 'acc_1',
    status: 'active',
    roles: ['user'],
    token_epoch: 3,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('the password is measured in bytes, not characters (TC-1, AC-10)', () => {
  it('rejects a 30-character Arabic password that a character count says is well within the limit', () => {
    // The study names this as an error that will certainly happen in an Arabic
    // deployment if the byte length is not written. Arabic is two bytes per
    // character in UTF-8, so 30 characters is 60 bytes — under the limit — while
    // 40 characters is 80 and over it. The point of the test is that the two
    // numbers are different, and that the code uses the right one.
    const thirty = 'ك'.repeat(30)
    expect(thirty.length).toBe(30)
    expect(passwordByteLength(thirty)).toBe(60)
    expect(passwordError(thirty)).toBeNull()

    const forty = 'ك'.repeat(40)
    expect(forty.length).toBe(40)
    expect(passwordByteLength(forty)).toBe(80)
    expect(passwordError(forty)).toMatch(/80 bytes/)
  })

  it('accepts an 8-character latin password and rejects a 7-character one', () => {
    expect(passwordError('abcdefgh')).toBeNull()
    expect(passwordError('abcdefg')).toMatch(/at least 8 bytes/)
  })

  it('measures an emoji at four bytes, so the limit falls between 18 and 19 of them', () => {
    // Not decoration: an emoji is the other common case where the character
    // count and the byte count diverge, and it diverges by 4× rather than 2×.
    // 18 is exactly 72 bytes and is accepted — the boundary is inclusive, which
    // is asserted here rather than assumed, because an off-by-one at 72 rejects
    // a password bcrypt would have taken.
    expect(passwordByteLength('😀')).toBe(4)
    expect(passwordError('😀'.repeat(18))).toBeNull()
    expect(passwordError('😀'.repeat(19))).toMatch(/76 bytes/)
  })

  it('is silent on an empty field — that is "not filled in yet", not "invalid"', () => {
    expect(passwordError('')).toBeNull()
  })

  it('never quotes the password in the message it returns', () => {
    // The whole hazard on this surface is a credential reaching a rendered
    // string. A validator that echoed what was typed would be the shortest path
    // there, so the message is asserted to contain the counts and not the value.
    const secret = 'a'.repeat(100)
    const message = passwordError(secret)!
    expect(message).toMatch(/100 bytes/)
    expect(message).not.toContain(secret)
  })

  it('states the limits it was given rather than hard-coded numbers', () => {
    expect(PASSWORD_MIN_BYTES).toBe(8)
    expect(PASSWORD_MAX_BYTES).toBe(72)
  })
})

describe('the username is normalised as it is typed (TC-12, AC-11)', () => {
  it('lower-cases and trims, admitting @ so an email can be a login name', () => {
    expect(normaliseUsername('  A@b  ')).toBe('a@b')
    expect(usernameError('A@b')).toBeNull()
    expect(usernameError('sara@acme.com')).toBeNull()
  })

  it('requires a letter or a digit first', () => {
    expect(usernameError('_x')).toMatch(/starts with a letter or a digit/)
    expect(usernameError('@sara')).toMatch(/starts with a letter or a digit/)
    expect(usernameError('9lives')).toBeNull()
  })

  it('enforces 2 to 64 characters', () => {
    expect(usernameError('a')).toMatch(/2 to 64/)
    expect(usernameError('ab')).toBeNull()
    expect(usernameError('a'.repeat(64))).toBeNull()
    expect(usernameError('a'.repeat(65))).toMatch(/2 to 64/)
  })

  it('does not reject a bidi override — that is the render layer’s job, not this one', () => {
    // Asserted rather than left implicit, because the temptation is to "fix" it
    // here. Being stricter than the server rejects input the server would have
    // taken; the hazard is in the rendering, and `displayText` closes it at
    // every render site.
    expect(usernameError('sara‮evil')).toBeNull()
  })

  it('is silent on an empty field', () => {
    expect(usernameError('')).toBeNull()
  })
})

describe('the email is optional (AC-12)', () => {
  it('accepts a blank one and rejects something that is not an address', () => {
    expect(emailError('')).toBeNull()
    expect(emailError('   ')).toBeNull()
    expect(emailError('sara@acme.com')).toBeNull()
    expect(emailError('sara')).toMatch(/does not look like/)
  })
})

describe('exactly one account arm produces a request (TC-10, AC-6, AC-7)', () => {
  it('builds the existing-account body with account_id and no account object', () => {
    const payload = createUserPayloadFrom(FIELDS)!
    expect(payload).not.toBeNull()
    expect(payload).toMatchObject({ username: 'sara', account_id: 'acc_1' })
    expect('account' in payload).toBe(false)
  })

  it('builds the new-account body with account and no account_id', () => {
    const payload = createUserPayloadFrom({
      ...FIELDS,
      arm: 'new',
      accountId: 'acc_1',
      newAccountId: 'acc_new',
      newAccountName: 'New Co',
    })!
    expect(payload).toMatchObject({ account: { account_id: 'acc_new', name: 'New Co' } })
    expect('account_id' in payload).toBe(false)
  })

  it('refuses to build a body when the selected arm is not filled in', () => {
    // A user with a blank account can address no device, so that request must
    // not exist even for a moment. `null` is what makes it unbuildable rather
    // than buildable-and-refused.
    expect(createUserPayloadFrom({ ...FIELDS, accountId: '' })).toBeNull()
    expect(createUserPayloadFrom({ ...FIELDS, accountId: '   ' })).toBeNull()
    expect(createUserPayloadFrom({ ...FIELDS, arm: 'new' })).toBeNull()
    expect(createUserPayloadFrom({ ...FIELDS, arm: 'new', newAccountId: 'acc_new' })).toBeNull()
    expect(createUserPayloadFrom({ ...FIELDS, arm: 'new', newAccountName: 'New Co' })).toBeNull()
  })

  it('normalises the username into the body', () => {
    expect(createUserPayloadFrom({ ...FIELDS, username: '  SARA  ' })!.username).toBe('sara')
  })
})

describe('an omitted field is not an empty one, at creation (TC-11, AC-8, AC-12)', () => {
  it('omits roles entirely when none is chosen, so the server applies its own default', () => {
    // Not `roles: []`. An empty array asks for a user holding no role at all,
    // which is a different request from "apply the least privileged default".
    const payload = createUserPayloadFrom(FIELDS)!
    expect('roles' in payload).toBe(false)
  })

  it('sends the complete set when roles are chosen, discarding blank free-text entries', () => {
    const payload = createUserPayloadFrom({ ...FIELDS, roles: ['user', '  ', 'billing'] })!
    expect(payload.roles).toEqual(['user', 'billing'])
  })

  it('omits email when blank and sends it when filled', () => {
    expect('email' in createUserPayloadFrom(FIELDS)!).toBe(false)
    expect(createUserPayloadFrom({ ...FIELDS, email: ' sara@acme.com ' })!.email).toBe(
      'sara@acme.com',
    )
  })

  it('always sends status, because the form always has one selected (AC-9)', () => {
    expect(createUserPayloadFrom({ ...FIELDS, status: 'disabled' })!.status).toBe('disabled')
  })
})

describe('the edit payload carries only what changed (TC-2, TC-3, AC-15, AC-16)', () => {
  it('is empty when nothing changed, and the guard says so', () => {
    const payload = updatePayloadFrom(ORIGINAL, { ...ORIGINAL })
    expect(payload).toEqual({})
    expect(isEmptyUpdate(payload)).toBe(true)
  })

  it('carries status alone when only the status changed', () => {
    // The ticket's own test case: account_id, email and roles must be ABSENT
    // from the JSON, not present and equal.
    const payload = updatePayloadFrom(ORIGINAL, { ...ORIGINAL, status: 'disabled' })
    expect(payload).toEqual({ status: 'disabled' })
    expect(Object.keys(payload)).toEqual(['status'])
    const json = JSON.stringify(payload)
    expect(json).not.toContain('account_id')
    expect(json).not.toContain('email')
    expect(json).not.toContain('roles')
    expect(isEmptyUpdate(payload)).toBe(false)
  })

  it('treats a reordered role set as no change at all', () => {
    const payload = updatePayloadFrom(ORIGINAL, { ...ORIGINAL, roles: ['user', 'admin'] })
    expect(payload).toEqual({})
  })
})

describe('account_id is never submitted empty (TC-5, AC-17)', () => {
  it('omits it when it is unchanged', () => {
    expect(updatePayloadFrom(ORIGINAL, { ...ORIGINAL, accountId: 'acc_1' })).toEqual({})
  })

  it('omits it when it has been blanked, rather than sending an empty string', () => {
    // Sending '' is an attempt to leave the user able to address nothing and is
    // refused by the server. There is no path through this function that builds
    // it — which is stronger than validating for it afterwards.
    expect(updatePayloadFrom(ORIGINAL, { ...ORIGINAL, accountId: '' })).toEqual({})
    expect(updatePayloadFrom(ORIGINAL, { ...ORIGINAL, accountId: '   ' })).toEqual({})
  })

  it('sends it when it names a different account', () => {
    expect(updatePayloadFrom(ORIGINAL, { ...ORIGINAL, accountId: 'acc_2' })).toEqual({
      account_id: 'acc_2',
    })
  })

  it('still allows an email to be cleared, which is a real instruction', () => {
    // The asymmetry with account_id is deliberate: an email is "unique when
    // non-blank; several users may have none", so '' is a legitimate change.
    expect(updatePayloadFrom(ORIGINAL, { ...ORIGINAL, email: '' })).toEqual({ email: '' })
  })
})

describe('roles replace rather than merge (TC-4, AC-18)', () => {
  it('submits the complete remaining set when one is unchecked', () => {
    const payload = updatePayloadFrom(ORIGINAL, { ...ORIGINAL, roles: ['user'] })
    expect(payload.roles).toEqual(['user'])
  })

  it('submits the complete set when one is added — never a delta', () => {
    const payload = updatePayloadFrom(ORIGINAL, {
      ...ORIGINAL,
      roles: ['admin', 'user', 'billing'],
    })
    expect(payload.roles).toEqual(['admin', 'user', 'billing'])
  })

  it('submits an empty array when every role is removed, which is a real request', () => {
    const payload = updatePayloadFrom(ORIGINAL, { ...ORIGINAL, roles: [] })
    expect(payload.roles).toEqual([])
    expect(isEmptyUpdate(payload)).toBe(false)
  })

  it('seeds the form from the row with the roles sorted', () => {
    expect(editableFrom(user({ roles: ['user', 'admin'] })).roles).toEqual(['admin', 'user'])
  })

  it('offers the three seeded ids and nothing more', () => {
    expect(SEEDED_ROLES).toEqual(['user', 'admin', 'super_admin'])
  })
})

describe('which seeded roles a principal may be offered', () => {
  it('offers every seeded id to a principal holding the global grant', () => {
    expect(assignableRoles(true)).toEqual(['user', 'admin', 'super_admin'])
  })

  it('RULE: without the global grant, only the account-scoped roles are offered', () => {
    // An account administrator holds `users.manage` and not `users.manage.all`.
    // The backend refuses privilege escalation — "you cannot grant a permission
    // you do not hold yourself" — with a 403, so offering `super_admin` is
    // offering a control that will be refused.
    expect(assignableRoles(false)).toEqual(['user', 'admin'])
    expect(assignableRoles(false)).not.toContain('super_admin')
  })

  it('drops every globally scoped id, not one name', () => {
    // The classification is a list, so a second global role seeded later is
    // covered by the same decision rather than by a second special case.
    for (const global of GLOBALLY_SCOPED_ROLES) {
      expect(assignableRoles(false)).not.toContain(global)
      expect(assignableRoles(true)).toContain(global)
    }
  })

  it('leaves SEEDED_ROLES itself untouched — it is a classifier, not the offer', () => {
    // The edit dialog uses it to tell a seeded id from an operator-composed one,
    // and that question does not change with who is asking.
    assignableRoles(false)
    expect(SEEDED_ROLES).toEqual(['user', 'admin', 'super_admin'])
  })

  it('the decision takes a permission, so it never asks what anybody is called', () => {
    // The whole point of the boolean: the same two answers are reachable by a
    // composed role that holds `users.manage.all` and by one that does not, and
    // neither is expressible as a comparison against a role name.
    expect(assignableRoles(true)).not.toEqual(assignableRoles(false))
  })
})

describe('which change could remove administration', () => {
  it('is a disable or any role rewrite, and nothing else', () => {
    expect(mayRemoveAdministration({ status: 'disabled' })).toBe(true)
    expect(mayRemoveAdministration({ roles: ['user'] })).toBe(true)
    expect(mayRemoveAdministration({ roles: [] })).toBe(true)
    expect(mayRemoveAdministration({ status: 'active' })).toBe(false)
    expect(mayRemoveAdministration({ email: 'x@y.z' })).toBe(false)
    expect(mayRemoveAdministration({})).toBe(false)
  })
})

describe('the rejections this surface must show plainly (TC-6, TC-7, TC-8, AC-23, AC-25)', () => {
  const other = { targetIsSelf: false, mayCollide: true, mayRemoveAdmin: false }
  const self = { targetIsSelf: true, mayCollide: false, mayRemoveAdmin: false }

  it('reads a 403 on your own delete as self-mutation and on anybody else as escalation', () => {
    expect(userRejection(httpError(403), 'delete', self)).toBe('self-mutation')
    expect(userRejection(httpError(403), 'delete', other)).toBe('privilege-escalation')
  })

  it('reads a 403 on disabling yourself as self-mutation', () => {
    expect(userRejection(httpError(403), 'update', { ...self, mayRemoveAdmin: true })).toBe(
      'self-mutation',
    )
  })

  it('reads a 403 on changing your own email as escalation, not self-mutation', () => {
    // Changing your own roles is allowed because it can only narrow, and an
    // email is not a self-mutation at all — so a 403 there is the privilege
    // ceiling, and saying "you cannot do this to your own account" would be
    // wrong.
    expect(userRejection(httpError(403), 'update', self)).toBe('privilege-escalation')
  })

  it('reads a 409 on a delete as the last-administrator guard', () => {
    expect(userRejection(httpError(409), 'delete', other)).toBe('last-administrator')
  })

  it('reads a 409 on a disable or a role rewrite as the last-administrator guard', () => {
    expect(userRejection(httpError(409), 'update', { ...other, mayRemoveAdmin: true })).toBe(
      'last-administrator',
    )
  })

  it('reads a 409 on a create as a collision', () => {
    expect(userRejection(httpError(409), 'create', other)).toBe('already-taken')
  })

  it('prefers the last-administrator reading when a change could be either', () => {
    // An edit that changes an email AND disables the account can collide or hit
    // the guard, and the server says which by not saying. The consequential
    // reading is chosen and the caller appends collisionDetail anyway, so both
    // are on screen — the client never picks between two causes the server
    // deliberately joined.
    expect(
      userRejection(httpError(409), 'update', {
        targetIsSelf: false,
        mayCollide: true,
        mayRemoveAdmin: true,
      }),
    ).toBe('last-administrator')
  })

  it('reads a 503 on a password-carrying request as the bcrypt queue', () => {
    expect(userRejection(httpError(503), 'create', other)).toBe('password-hashing-busy')
    expect(userRejection(httpError(503), 'reset', other)).toBe('password-hashing-busy')
  })

  it('does not claim a 503 on an update is about hashing — that request carries no password', () => {
    expect(userRejection(httpError(503), 'update', other)).toBeNull()
  })

  it('reads a 404 as the non-committal not-found', () => {
    expect(userRejection(httpError(404), 'update', other)).toBe('not-found')
  })

  it('returns null for a status it does not recognise, so the caller falls through', () => {
    expect(userRejection(httpError(400), 'create', other)).toBeNull()
    expect(userRejection(httpError(500), 'delete', other)).toBeNull()
    expect(userRejection(new Error('offline'), 'create', other)).toBeNull()
  })
})

describe('no server text is rendered for a request that carried a password (TC-16, AC-31)', () => {
  it('redacts any 4xx or 5xx, because a rejection can quote the field it rejected', () => {
    expect(passwordFailure(httpError(400, 'password "hunter2" is too weak'))).toBe('redacted')
    expect(passwordFailure(httpError(409))).toBe('redacted')
    expect(passwordFailure(httpError(503))).toBe('redacted')
  })

  it('keeps the text when nothing answered, because there is no response to have echoed one', () => {
    // status 0 is offline, DNS, or a cancelled request. Discarding the only
    // diagnostic there would make an unreachable server look like a rejected
    // password.
    expect(passwordFailure(new Error('Network Error'))).toBe('server')
  })
})

describe('the detail names what this client sent, never what the server holds (TC-9, AC-26)', () => {
  it('lists the three values a 409 could have been about, and says the server did not say which', () => {
    const detail = collisionDetail({
      username: 'sara',
      email: 'sara@acme.com',
      accountId: 'acc_new',
    })
    expect(detail).toContain('sara')
    expect(detail).toContain('sara@acme.com')
    expect(detail).toContain('acc_new')
    expect(detail).toMatch(/does not say which/)
  })

  it('names only what was actually sent', () => {
    const detail = collisionDetail({ username: 'sara' })
    expect(detail).toContain('sara')
    expect(detail).not.toContain('email')
    expect(detail).not.toContain('account id')
  })

  it('is empty when nothing identifying was sent, so the caller appends nothing', () => {
    expect(collisionDetail({})).toBe('')
    expect(notFoundDetail({})).toBe('')
  })

  it('names the free-text role a 404 was probably about', () => {
    // The reason this builder is worth having: there is no endpoint listing
    // roles, so a bare 404 after typing one is unreadable.
    const detail = notFoundDetail({ userId: 'usr_1', roles: ['billing', '  '] })
    expect(detail).toContain('billing')
    expect(detail).toContain('usr_1')
    expect(detail).not.toMatch(/role “ *”/)
  })

  it('stays non-committal between "gone" and "not yours"', () => {
    expect(notFoundDetail({ accountId: 'acc_9' })).toMatch(/same way for/)
  })

  it('strips a bidi override out of every value before interpolating it (AC-32)', () => {
    // These sentences are rendered, and every value in them is operator-typed.
    // A U+202E reaching the string would reorder the sentence around it.
    const detail = collisionDetail({ username: 'sara‮evil', email: 'a​@b.c' })
    expect(detail).not.toContain('‮')
    expect(detail).not.toContain('​')
    expect(detail).toContain('saraevil')
  })

  it('caps a value long enough to push the rest of the sentence off screen', () => {
    const detail = collisionDetail({ username: 'a'.repeat(300) })
    expect(detail).toContain('…')
    expect(detail).not.toContain('a'.repeat(100))
  })
})

describe('identity is decided on user_id alone (TC-15, AC-20, AC-24)', () => {
  it('matches the signed-in principal and nothing else', () => {
    expect(isSelf('usr_1', 'usr_1')).toBe(true)
    expect(isSelf('usr_1', 'usr_2')).toBe(false)
  })

  it('is false with no session, so an anonymous render hides nothing by accident', () => {
    expect(isSelf('usr_1', null)).toBe(false)
    expect(isSelf('usr_1', undefined)).toBe(false)
    expect(isSelf('usr_1', '')).toBe(false)
  })
})

describe('the account filter narrows within the loaded page (TC-14, AC-3)', () => {
  const page = [user(), user({ user_id: 'usr_2', account_id: 'acc_2' })]

  it('keeps only the rows of that account', () => {
    expect(filterByAccount(page, 'acc_1').map((u) => u.user_id)).toEqual(['usr_1'])
  })

  it('returns the same array reference when no filter is set', () => {
    // Identity matters: a memoised consumer must not re-render for a filter
    // nobody set.
    expect(filterByAccount(page, undefined)).toBe(page)
  })

  it('answers an empty list rather than throwing while the page is loading', () => {
    expect(filterByAccount(undefined, 'acc_1')).toEqual([])
  })
})

describe('paging is next/previous, because there is no total (TC-13, AC-2)', () => {
  it('offers a next page only when the page came back full', () => {
    expect(pageState(100, 100, 0).canNext).toBe(true)
    expect(pageState(99, 100, 0).canNext).toBe(false)
    expect(pageState(0, 100, 0).canNext).toBe(false)
  })

  it('offers a previous page only away from the start, and never lands below zero', () => {
    expect(pageState(100, 100, 0).canPrevious).toBe(false)
    expect(pageState(100, 100, 100).canPrevious).toBe(true)
    expect(pageState(100, 100, 50).previousOffset).toBe(0)
    expect(pageState(100, 100, 300).previousOffset).toBe(200)
  })

  it('advances by the page size', () => {
    expect(pageState(100, 100, 100).nextOffset).toBe(200)
  })

  it('exposes no page count and no total — there is no source for either', () => {
    expect(Object.keys(pageState(100, 100, 0)).sort()).toEqual([
      'canNext',
      'canPrevious',
      'nextOffset',
      'previousOffset',
    ])
  })

  it('asks for 100 and clamps at the server’s ceiling of 500', () => {
    expect(DEFAULT_PAGE_SIZE).toBe(100)
    expect(MAX_PAGE_SIZE).toBe(500)
  })
})
