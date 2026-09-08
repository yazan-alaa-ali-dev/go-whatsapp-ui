import { AxiosError } from 'axios'
import { describe, expect, it } from 'vitest'
import type { DeviceWebhookConfig } from '@/api/devices'
import {
  CLEARS_WEBHOOK_WARNING,
  DISABLED_MEANS,
  ENABLING_RESUMES,
  INSECURE_SKIP_VERIFY_MEANS,
  WEBHOOK_SAVE_FAILED_REDACTED,
  webhookEnabledFrom,
  webhookPayloadFrom,
  webhookSaveEffect,
  webhookSaveFailure,
  webhookUrlNotice,
} from './device-webhook'

/**
 * Disabling a webhook and clearing its URL are different operations, and this
 * file is where that difference is asserted. The product conflated them until
 * this ticket.
 */

function config(extra: Partial<DeviceWebhookConfig> = {}): DeviceWebhookConfig {
  return {
    device_id: 'acme-prod-1',
    webhook_url: 'https://example.com/webhook',
    webhook_secret: 'super-secret-key',
    webhook_events: 'message,message.ack',
    webhook_insecure_skip_verify: false,
    ...extra,
  }
}

function rejection(status: number): AxiosError {
  return new AxiosError('failed', 'ERR', undefined, undefined, {
    status,
    data: { code: String(status), message: 'webhook_secret is invalid', results: null },
    statusText: '',
    headers: {},
    config: { headers: {} },
  } as never)
}

describe('clearing the URL is a deletion, not a disable', () => {
  it('reads an empty URL as a deletion', () => {
    // TC-14. The one operation the reference explicitly warns about, and the
    // one the previous dialog recommended in its own description text.
    expect(webhookSaveEffect('')).toBe('clear')
    expect(webhookSaveEffect('   ')).toBe('clear')
  })

  it('reads a URL as a plain update', () => {
    expect(webhookSaveEffect('https://example.com/webhook')).toBe('set')
  })

  it('warns about all three erased values and about where the events then go', () => {
    // The warning must carry both halves. "Your webhook will be removed" is
    // true and useless: the operator's next question is whether the events stop,
    // and the answer — they do not — is the one that changes what they do.
    expect(CLEARS_WEBHOOK_WARNING).toMatch(/URL/)
    expect(CLEARS_WEBHOOK_WARNING).toMatch(/secret/i)
    expect(CLEARS_WEBHOOK_WARNING).toMatch(/event list/i)
    expect(CLEARS_WEBHOOK_WARNING).toMatch(/fall back/i)
    expect(CLEARS_WEBHOOK_WARNING).toMatch(/deployment-wide/i)
    expect(CLEARS_WEBHOOK_WARNING).not.toMatch(/events stop|stops delivery/i)
  })
})

describe('what switching delivery off actually does', () => {
  it('states all four consequences', () => {
    // AC-30. The fourth is the one nobody expects: the customer stops getting
    // automatic replies, which is a change they experience.
    expect(DISABLED_MEANS).toHaveLength(4)
    const all = DISABLED_MEANS.join(' ')
    expect(all).toMatch(/webhook URL/i)
    expect(all).toMatch(/silence, not redirection/i)
    expect(all).toMatch(/agent bridge/i)
    expect(all).toMatch(/still received and stored/i)
  })

  it('says that re-enabling needs nothing re-entered', () => {
    // AC-31. An operator who believes disabling loses the configuration will
    // avoid the switch and clear the URL instead — the destructive path.
    expect(ENABLING_RESUMES).toMatch(/same URL/i)
    expect(ENABLING_RESUMES).toMatch(/same signing secret/i)
    expect(ENABLING_RESUMES).toMatch(/nothing to re-enter/i)
  })

  it('says what skipping certificate verification costs', () => {
    expect(INSECURE_SKIP_VERIFY_MEANS).toMatch(/certificate/i)
    expect(INSECURE_SKIP_VERIFY_MEANS).toMatch(/whatever answers/i)
  })
})

describe('the delivery switch reads an absent field as on, and says it inferred that', () => {
  it('reports the value the server sent', () => {
    expect(webhookEnabledFrom(config({ webhook_enabled: false }))).toEqual({
      enabled: false,
      reported: true,
    })
    expect(webhookEnabledFrom(config({ webhook_enabled: true }))).toEqual({
      enabled: true,
      reported: true,
    })
  })

  it('assumes on when the field is absent, and marks the assumption', () => {
    // TC-15. A device with no webhook configuration at all reports true —
    // absence of configuration is not being silenced — so `false` would be the
    // wrong default. But it is an assumption, and the switch says so.
    expect(webhookEnabledFrom(config())).toEqual({ enabled: true, reported: false })
  })
})

describe('the save payload keeps the empty URL and the stored secret', () => {
  it('sends the URL even when it is empty, because empty is the deletion', () => {
    // The payload-cleaning helper in @/api/request drops '' as well as
    // undefined, which would turn a deletion into a no-op body.
    const payload = webhookPayloadFrom({
      url: '  ',
      secret: 'super-secret-key',
      events: '',
      insecureSkipVerify: false,
    })
    expect(payload).toHaveProperty('webhook_url', '')
    expect(Object.keys(payload)).toContain('webhook_url')
  })

  it('round-trips the secret unchanged, without trimming it', () => {
    // A secret is an opaque string: trimming it would change the value and
    // break the signature the receiving endpoint verifies.
    const payload = webhookPayloadFrom({
      url: 'https://example.com/webhook',
      secret: '  padded-secret  ',
      events: ' message ',
      insecureSkipVerify: true,
    })
    expect(payload.webhook_secret).toBe('  padded-secret  ')
    expect(payload.webhook_events).toBe('message')
    expect(payload.webhook_url).toBe('https://example.com/webhook')
    expect(payload.webhook_insecure_skip_verify).toBe(true)
  })
})

describe('a URL that is not https is noticed, not refused', () => {
  it('says nothing about an https URL or an empty one', () => {
    expect(webhookUrlNotice('https://example.com/webhook')).toBeNull()
    expect(webhookUrlNotice('HTTPS://EXAMPLE.COM/webhook')).toBeNull()
    expect(webhookUrlNotice('')).toBeNull()
  })

  it('states the consequence for http', () => {
    const notice = webhookUrlNotice('http://example.com/webhook')
    expect(notice).toMatch(/not https/i)
    expect(notice).toMatch(/read/i)
  })

  it('notices a string that is not a URL rather than rejecting it', () => {
    // The server is the authority on what it accepts; guessing which malformed
    // strings it would have taken is how a client refuses valid input.
    expect(webhookUrlNotice('example.com/webhook')).not.toBeNull()
  })
})

describe('a failed save never renders server text that carried the secret', () => {
  it('redacts any response-bearing failure', () => {
    // The rejection body in this file's helper literally quotes the field, which
    // is the case this exists for.
    expect(webhookSaveFailure(rejection(400))).toBe('redacted')
    expect(webhookSaveFailure(rejection(404))).toBe('redacted')
    expect(webhookSaveFailure(rejection(500))).toBe('redacted')
  })

  it('keeps the text when there was no response to echo anything', () => {
    // status 0 — offline, DNS, a cancelled request. Discarding this would make
    // an unreachable server look like a rejected secret.
    expect(webhookSaveFailure(new Error('Network Error'))).toBe('server')
  })

  it('names no value in the redacted sentence', () => {
    expect(WEBHOOK_SAVE_FAILED_REDACTED).toMatch(/not saved/i)
    expect(WEBHOOK_SAVE_FAILED_REDACTED).not.toMatch(/super-secret-key/)
  })
})
