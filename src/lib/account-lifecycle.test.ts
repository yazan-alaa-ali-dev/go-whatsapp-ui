import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { describe, expect, it } from 'vitest'
import type { DeleteAccountResult } from '@/api/accounts'
import {
  CREATE_FAILED_REDACTED,
  META_TOKEN_PREFIX,
  confirmationMatches,
  createAccountPayloadFrom,
  createFailure,
  deleteOutcome,
  deleteRejection,
  deleteRequestFor,
  isOwnAccountDeletion,
  metaTokenRefError,
} from './account-lifecycle'

/**
 * The decisions of the account lifecycle, asserted where they live.
 *
 * There is no component renderer in this environment, which is why these are
 * functions rather than JSX in the first place — see the module header. Each
 * test below states the damage the decision exists to prevent, because a test
 * that only restates the implementation proves nothing when the implementation
 * is what changed.
 */

/** An `ApiError`-shaped rejection, which is what `src/lib/http.ts` rejects with. */
function apiError(status: number, code = String(status), message = 'refused') {
  return { status, code, message }
}

/** The other shape `toApiError` normalises: a raw axios failure. */
function axiosError(status: number, code: string) {
  const config = {} as InternalAxiosRequestConfig
  const response = {
    status,
    data: { code, message: 'refused', results: null },
    statusText: '',
    headers: {},
    config,
  } as AxiosResponse
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, undefined, response)
}

function report(overrides: Partial<DeleteAccountResult> = {}): DeleteAccountResult {
  return {
    account_id: 'acc-a',
    account_deleted: true,
    purged_devices: [],
    failed_devices: [],
    not_attempted_devices: [],
    ...overrides,
  }
}

describe('meta_token_ref is a name, not a value (AC-8, TC-5)', () => {
  it('rejects a literal access token before it can reach a request body', () => {
    // The failure this exists to prevent: a Meta token pasted into the field and
    // sent lives in a request body, in every intermediary's log, and in the
    // browser's own network panel. Client-side is the only place it can be
    // stopped, which is why the check is not left to the server.
    expect(metaTokenRefError('EAAGm0PX4ZCpsBA1234567890abcdefGHIJK')).toContain(META_TOKEN_PREFIX)
    expect(metaTokenRefError('EAAGm0PX4ZCpsBA1234567890abcdefGHIJK')).toContain('not the token')
  })

  it('rejects a name outside the configured prefix, and names the prefix in the message', () => {
    const error = metaTokenRefError('ALPHA_TOKEN')
    expect(error).not.toBeNull()
    expect(error).toContain('META_TOKEN_')
  })

  it('rejects a name carrying characters an environment variable cannot hold', () => {
    for (const value of ['META_TOKEN_a b', 'META_TOKEN_a-b', 'META_TOKEN_a.b', 'META_TOKEN_']) {
      expect(metaTokenRefError(value), value).not.toBeNull()
    }
  })

  it('accepts the reference’s own example, and either case after the prefix', () => {
    expect(metaTokenRefError('META_TOKEN_ALPHA')).toBeNull()
    // Deliberately permissive: being stricter than the server rejects input the
    // server would have taken, and a lowercase suffix is not the thing being
    // guarded against — a literal token fails on the prefix, first character.
    expect(metaTokenRefError('META_TOKEN_alpha_2')).toBeNull()
    expect(metaTokenRefError('  META_TOKEN_ALPHA  ')).toBeNull()
  })

  it('treats a blank field as absent, because the reference is optional', () => {
    expect(metaTokenRefError('')).toBeNull()
    expect(metaTokenRefError('   ')).toBeNull()
  })

  it('NEVER quotes what was typed back into the message', () => {
    // The whole hazard is a token reaching a rendered string, and an error
    // message quoting the value it rejected is the shortest path there. The
    // sentence is fixed and names only the prefix.
    const token = 'EAAGm0PX4ZCpsBA1234567890abcdefGHIJK'
    expect(metaTokenRefError(token)).not.toContain(token)
    expect(metaTokenRefError('sk-secret-value')).not.toContain('secret')
  })
})

describe('the create body omits what was left blank (AC-7, TC-6)', () => {
  it('omits account_id rather than sending an empty one', () => {
    // "Generated when omitted" — sending `''` asks the server to name an account
    // the empty string, which is a different request entirely.
    const payload = createAccountPayloadFrom({ accountId: '  ', name: 'Acme', metaTokenRef: '' })
    expect(payload).toEqual({ name: 'Acme' })
    expect('account_id' in payload).toBe(false)
    expect('meta_token_ref' in payload).toBe(false)
  })

  it('sends all three, trimmed, when all three were given', () => {
    expect(
      createAccountPayloadFrom({
        accountId: ' acc_alpha ',
        name: ' Alpha Support ',
        metaTokenRef: ' META_TOKEN_ALPHA ',
      }),
    ).toEqual({
      account_id: 'acc_alpha',
      name: 'Alpha Support',
      meta_token_ref: 'META_TOKEN_ALPHA',
    })
  })
})

describe('the typed confirmation (AC-13, TC-10)', () => {
  it('forgives surrounding whitespace and nothing else', () => {
    // The target is the ACCOUNT ID, revised after the advisory panel: a name is
    // not unique, and it is server text that accountName must strip and cap — so
    // confirming against it means showing either a string the operator cannot
    // type or a raw one that re-opens the bidi reordering attack.
    expect(confirmationMatches('  acc_alpha  ', 'acc_alpha')).toBe(true)
    // Two accounts of one customer are routinely one character apart.
    expect(confirmationMatches('acc_alpha2', 'acc_alpha')).toBe(false)
    expect(confirmationMatches('ACC_ALPHA', 'acc_alpha')).toBe(false)
    expect(confirmationMatches('acc alpha', 'acc_alpha')).toBe(false)
  })

  it('never matches an empty box, whatever the target', () => {
    expect(confirmationMatches('', 'acc_alpha')).toBe(false)
    expect(confirmationMatches('', '')).toBe(false)
    expect(confirmationMatches('   ', '  ')).toBe(false)
  })
})

describe('deleting the account you belong to (AC-21a, TC-9b)', () => {
  it('recognises the principal’s own account', () => {
    // An account administrator's only row IS their own account, so the single
    // delete this screen offers them is an irreversible self-lockout with no
    // recovery through the product.
    expect(isOwnAccountDeletion('acc-a', 'acc-a')).toBe(true)
    expect(isOwnAccountDeletion(' acc-a ', 'acc-a')).toBe(true)
  })

  it('does not warn about anybody else’s account', () => {
    expect(isOwnAccountDeletion('acc-b', 'acc-a')).toBe(false)
  })

  it('says nothing when the principal belongs to no account', () => {
    // '' is the reference's "belongs to no account" (§05): it owns nothing, so
    // no delete can lock it out of anything.
    expect(isOwnAccountDeletion('acc-a', '')).toBe(false)
    expect(isOwnAccountDeletion('acc-a', null)).toBe(false)
    expect(isOwnAccountDeletion('acc-a', undefined)).toBe(false)
  })

  it('does not match two absences against each other', () => {
    // The case the mutation pass found surviving: dropping the `own !== ''`
    // guard leaves every other assertion above green, because a blank own
    // account still fails a comparison with a real id. It only shows here —
    // "belongs to no account" is not the same fact as "belongs to the account
    // whose id is blank", and reading them as equal would warn a user about a
    // lockout that cannot happen.
    expect(isOwnAccountDeletion('', '')).toBe(false)
    expect(isOwnAccountDeletion('   ', '  ')).toBe(false)
  })
})

describe('the request the second step sends (AC-12, AC-14, TC-2, TC-3)', () => {
  const TWO = [{ device_id: 'dev_a' }, { device_id: 'dev_b' }]

  it('counts the LIST it was given, never a number it was told', () => {
    // The signature is the guarantee: a number is a value anything can mint —
    // a cached count, a stale getQueryData, a literal 0 — and every one of those
    // would be a type-correct call that every test here passes. The array is the
    // one the live read just returned.
    expect(deleteRequestFor(true, TWO)).toEqual({ purgeDevices: true, expectedDevices: 2 })
  })

  it('sends a zero count as a zero, not as an omission', () => {
    // "It is never defaulted — a missing value is not read as zero." The union in
    // src/api/accounts.ts makes the omission a compile error; this asserts the
    // value that is legitimately zero still travels.
    expect(deleteRequestFor(true, [])).toEqual({ purgeDevices: true, expectedDevices: 0 })
  })

  it('carries no cascade at all when it was not asked for, whatever the count', () => {
    // The refusal this produces (409 ACCOUNT_HAS_DEVICES) is the documented one,
    // and it is rendered rather than pre-empted: the client knows the count it
    // read a moment ago, not the count the server is about to read.
    expect(deleteRequestFor(false, TWO)).toEqual({ purgeDevices: false })
    expect(deleteRequestFor(false, [])).toEqual({ purgeDevices: false })
  })
})

describe('account_deleted is the only success signal (AC-17, TC-4, TC-8)', () => {
  it('reads a clean deletion as deleted', () => {
    expect(deleteOutcome(report({ purged_devices: ['dev_a', 'dev_b'] }))).toBe('deleted')
  })

  it('reads a 200 carrying account_deleted: false as kept, never as success', () => {
    // The failure this exists to prevent: a "deleted" message shown on a 200
    // without reading this field lies to the operator on every partial run.
    expect(
      deleteOutcome(
        report({
          account_deleted: false,
          purged_devices: ['dev_a'],
          failed_devices: ['dev_b'],
          not_attempted_devices: ['dev_c'],
        }),
      ),
    ).toBe('kept')
  })

  it('still reads account_deleted when a second field contradicts it', () => {
    // The reference says the account is kept whenever failed_devices is
    // non-empty, so this shape should not occur. It is asserted anyway: two
    // fields answering one question is how a 200 gets reported as a deletion
    // that did not happen, and the guarantee is that ONE field answers.
    expect(deleteOutcome(report({ account_deleted: true, failed_devices: ['dev_b'] }))).toBe(
      'deleted',
    )
    expect(deleteOutcome(report({ account_deleted: false, failed_devices: [] }))).toBe('kept')
  })
})

describe('which rejection this is, decided by the request that was made (AC-15, TC-7)', () => {
  it('reads the two documented codes when the envelope carries them', () => {
    expect(deleteRejection(axiosError(409, 'ACCOUNT_HAS_DEVICES'), true)).toBe('account-has-devices')
    expect(deleteRejection(axiosError(409, 'ACCOUNT_DEVICE_COUNT_MISMATCH'), false)).toBe(
      'account-device-count-mismatch',
    )
  })

  it('falls back on what was asked for, because the codes are inferred from prose', () => {
    // The ErrorBadRequest schema shows `code` carrying the HTTP status as a
    // string, so a semantic code may never arrive. Only one of the two
    // rejections is reachable for a given request shape, which makes this exact
    // rather than a guess.
    expect(deleteRejection(apiError(409), true)).toBe('account-device-count-mismatch')
    expect(deleteRejection(apiError(409), false)).toBe('account-has-devices')
  })

  it('maps a 404 to the shared not-found notice', () => {
    expect(deleteRejection(apiError(404), true)).toBe('not-found')
  })

  it('returns null for a 403, so the existing permission path renders it', () => {
    // toActionErrorMessage already keeps the server's text and — provably, in
    // src/lib/http.ts — spends no refresh and triggers no logout. Nothing here
    // may re-implement that, so a 403 must fall through.
    expect(deleteRejection(apiError(403), true)).toBeNull()
    expect(deleteRejection(apiError(500), false)).toBeNull()
    expect(deleteRejection(new Error('offline'), true)).toBeNull()
  })
})

describe('what a failed create renders (AC-9, AC-10, TC-5, TC-7)', () => {
  it('names the collision, because the operator chose the id a second ago', () => {
    // POST /accounts documents its 409 as ONE cause, unlike POST /auth/users
    // which joins three and must not be split — naming this one hands back
    // nothing the operator did not already type.
    expect(createFailure(apiError(409), false)).toEqual({
      kind: 'notice',
      rejection: 'account-id-taken',
    })
    expect(createFailure(axiosError(409, 'CONFLICT'), true)).toEqual({
      kind: 'notice',
      rejection: 'account-id-taken',
    })
  })

  it('REDACTS the server’s text when the failed request carried a reference', () => {
    // The hazard the advisory panel found: a 400 rejecting meta_token_ref may
    // quote the value it rejected, and toActionErrorMessage renders server text
    // verbatim. A request that carried a reference never renders server text.
    expect(createFailure(apiError(400), true)).toEqual({ kind: 'redacted' })
    expect(createFailure(apiError(403), true)).toEqual({ kind: 'redacted' })
    expect(createFailure(apiError(500), true)).toEqual({ kind: 'redacted' })
    expect(CREATE_FAILED_REDACTED).not.toContain('META_TOKEN')
  })

  it('keeps the server’s text when no reference was sent', () => {
    expect(createFailure(apiError(400), false)).toEqual({ kind: 'server' })
    expect(createFailure(apiError(403), false)).toEqual({ kind: 'server' })
  })

  it('keeps the text of a failure that had no server behind it', () => {
    // status 0 is offline, DNS, a cancelled request — there is no response to
    // have echoed anything, and the diagnosis is the only thing anyone has.
    expect(createFailure(new Error('Network Error'), true)).toEqual({ kind: 'server' })
  })
})
