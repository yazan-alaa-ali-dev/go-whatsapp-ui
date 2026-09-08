import { describe, expect, it } from 'vitest'
import { AxiosError, AxiosHeaders } from 'axios'
import {
  SMS_FALLBACK_ARMED,
  SMS_FALLBACK_CREDENTIALS,
  SMS_FALLBACK_EFFECT,
  SMS_FALLBACK_EXCLUSIONS,
  SMS_FALLBACK_GATEWAY,
  SMS_FALLBACK_ORDER,
  smsFallbackFailure,
  smsFallbackState,
} from '@/lib/account-settings'

/**
 * The copy on this screen IS the feature, so most of what follows asserts
 * sentences. That is not test theatre: the endpoint arms an account and says
 * nothing about whether the deployment's SMS gateway exists, so copy promising
 * delivery would be this screen's one real defect, and a promise is exactly the
 * kind of thing a later edit adds while "tidying the wording".
 */

function account(id: string, enabled: boolean) {
  return { account_id: id, name: id, sms_fallback_enabled: enabled }
}

/** An axios error carrying a status, the shape `toApiError` reads. */
function httpError(status: number): AxiosError {
  const error = new AxiosError('refused')
  error.response = {
    status,
    statusText: '',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: {},
  }
  return error
}

describe('smsFallbackState (AC-1, AC-3)', () => {
  it('reads the account out of the list', () => {
    const accounts = [account('acc-a', true), account('acc-b', false)]
    expect(smsFallbackState(accounts, 'acc-a')).toBe('on')
    expect(smsFallbackState(accounts, 'acc-b')).toBe('off')
  })

  it('RULE: a value nobody has read is `unknown`, never `off`', () => {
    // The three ways the value can be missing are all ways `off` would be a lie:
    // the list is pending (undefined), it was refused or empty, or it does not
    // carry this account. Rendering `false` for any of them says "disarmed"
    // about a value the server never sent.
    expect(smsFallbackState(undefined, 'acc-a')).toBe('unknown')
    expect(smsFallbackState([], 'acc-a')).toBe('unknown')
    expect(smsFallbackState([account('acc-b', true)], 'acc-a')).toBe('unknown')
  })

  it('is `unknown` when the field is not a boolean at all', () => {
    // `sms_fallback_enabled` is documented as ALWAYS present — no omitempty — so
    // its absence means the server broke its own contract, and reading that as
    // "disarmed" is the wrong repair.
    const malformed = [{ account_id: 'acc-a', name: 'a' }] as unknown as Parameters<
      typeof smsFallbackState
    >[0]
    expect(smsFallbackState(malformed, 'acc-a')).toBe('unknown')
  })

  it('matches the id exactly, with no normalisation', () => {
    expect(smsFallbackState([account('acc-a', true)], 'ACC-A')).toBe('unknown')
  })
})

describe('smsFallbackFailure (AC-10)', () => {
  it('RULE: a 404 is `not-found` — the answer that refuses to say which', () => {
    // The reference documents the 404 as byte-identical for an account that does
    // not exist and one belonging to another tenant. Guessing between them would
    // hand back the tenant-enumeration oracle the backend withheld.
    expect(smsFallbackFailure(httpError(404))).toBe('not-found')
  })

  it('RULE: a 403 is `permission`, so it never renders user-administration copy', () => {
    // ADMIN_REJECTIONS['privilege-escalation'] is about granting permissions and
    // changing users. Rendering it here would invent a cause the wire never
    // stated, on a screen about an account setting.
    expect(smsFallbackFailure(httpError(403))).toBe('permission')
  })

  it('invents nothing for any other status', () => {
    for (const status of [400, 409, 500, 503]) {
      expect(smsFallbackFailure(httpError(status))).toBe('unknown')
    }
  })

  it('treats a transport failure as unknown rather than as a refusal', () => {
    expect(smsFallbackFailure(new Error('offline'))).toBe('unknown')
  })
})

describe('the copy promises nothing the endpoint does not do (AC-4, AC-5)', () => {
  it('RULE: no sentence claims a message will be delivered by SMS', () => {
    // The correct phrase is "enabled for this account — it works once the
    // operator has configured the gateway", never "SMS messages enabled".
    const everything = [
      SMS_FALLBACK_ARMED,
      SMS_FALLBACK_GATEWAY,
      SMS_FALLBACK_ORDER,
      SMS_FALLBACK_EFFECT,
      SMS_FALLBACK_CREDENTIALS,
      ...SMS_FALLBACK_EXCLUSIONS,
    ].join(' ')
    for (const promise of [
      'SMS messages enabled',
      'will be delivered by SMS',
      'messages are sent by SMS',
      'SMS is enabled',
    ]) {
      expect(everything, `the copy must not promise delivery: "${promise}"`).not.toContain(promise)
    }
  })

  it('says the switch arms the account, and says it "may" rather than "will"', () => {
    expect(SMS_FALLBACK_ARMED).toContain('account level')
    expect(SMS_FALLBACK_ARMED).toContain('may then be delivered')
  })

  it('names the second switch, whose absence is not an error', () => {
    expect(SMS_FALLBACK_GATEWAY).toContain('two switches')
    expect(SMS_FALLBACK_GATEWAY).toContain('gateway configuration')
    expect(SMS_FALLBACK_GATEWAY).toContain('is not an error')
  })

  it('says this screen cannot report the deployment’s configuration', () => {
    // The response deliberately does not carry it. A screen that stayed silent
    // about that reads as "the gateway is fine".
    expect(SMS_FALLBACK_GATEWAY).toContain('does not report')
    expect(SMS_FALLBACK_GATEWAY).toContain('cannot tell you')
  })
})

describe('the copy states the exclusions and the ordering (AC-6, AC-7, AC-8, AC-9)', () => {
  it('names every kind that is never re-sent', () => {
    const exclusions = SMS_FALLBACK_EXCLUSIONS.join(' ')
    for (const kind of ['Media', 'stickers', 'contacts', 'locations', 'polls']) {
      expect(exclusions, `the exclusions must name ${kind}`).toContain(kind)
    }
    expect(exclusions).toContain('never re-sent')
  })

  it('names the group recipient and the undialable one', () => {
    const exclusions = SMS_FALLBACK_EXCLUSIONS.join(' ')
    expect(exclusions).toContain('group recipient')
    expect(exclusions).toContain('E.164')
  })

  it('states the one-SMS cap and that the gateway is never retried', () => {
    const exclusions = SMS_FALLBACK_EXCLUSIONS.join(' ')
    expect(exclusions).toContain('At most one SMS')
    expect(exclusions).toContain('never retried')
  })

  it('states that it is the last stage and never runs for a failure while sending', () => {
    expect(SMS_FALLBACK_ORDER).toContain('last stage, never the first')
    expect(SMS_FALLBACK_ORDER).toContain('while sending')
    expect(SMS_FALLBACK_ORDER).toContain('arriving twice')
  })

  it('states that it is idempotent and needs no restart or re-pairing', () => {
    expect(SMS_FALLBACK_EFFECT).toContain('next send attempt')
    expect(SMS_FALLBACK_EFFECT).toContain('no restart')
    expect(SMS_FALLBACK_EFFECT).toContain('re-pairing')
    expect(SMS_FALLBACK_EFFECT).toContain('idempotent')
  })

  it('states that gateway credentials are never entered here', () => {
    expect(SMS_FALLBACK_CREDENTIALS).toContain('never entered here')
    expect(SMS_FALLBACK_CREDENTIALS).toContain('deployment environment')
  })
})
