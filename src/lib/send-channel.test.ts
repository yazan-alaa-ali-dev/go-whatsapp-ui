import { describe, expect, it } from 'vitest'
import type { SendMessageResult, SendMessageWire } from '@/api/send'
import {
  carrierReference,
  deliveryChannel,
  deliveryNotice,
  MAX_CARRIER_REFERENCE,
  sendToast,
  shouldReadChatHistory,
  SMS_DELIVERY_NOTICE,
  UNRECOGNISED_DELIVERY_NOTICE,
  usableMessageId,
} from '@/lib/send-channel'

/**
 * The wire shape, built here and handed over as the narrowed one — which is what
 * every call site does at runtime. The cast is the test's licence to construct a
 * `message_id` the application type deliberately hides; the rule these tests
 * guard is that no *shipped* file may do the same.
 */
function result(fields: Partial<SendMessageWire>): SendMessageResult {
  return { message_id: '', status: 'ok', ...fields } as SendMessageResult
}

describe('deliveryChannel (AC-12, AC-12a)', () => {
  it('reads an absent field as whatsapp — what every other /send/* endpoint means', () => {
    expect(deliveryChannel(result({}))).toBe('whatsapp')
    expect(deliveryChannel(result({ channel: undefined }))).toBe('whatsapp')
  })

  it('reads the two documented values', () => {
    expect(deliveryChannel(result({ channel: 'whatsapp' }))).toBe('whatsapp')
    expect(deliveryChannel(result({ channel: 'sms' }))).toBe('sms')
  })

  it('RULE: anything else is NOT whatsapp — the decision fails safe', () => {
    // The obvious spelling — `channel === 'sms' ? 'sms' : 'whatsapp'` — fails
    // OPEN: the first time this server reports a third channel, every value this
    // dashboard does not know is read as WhatsApp and a foreign reference is
    // handed back as a WhatsApp message id. Only an absent field or the exact
    // literal answers `whatsapp`.
    for (const channel of ['SMS', 'WhatsApp', 'telegram', 'whatsapp ', '', 'sms\n']) {
      expect(deliveryChannel(result({ channel })), `"${channel}" must not read as whatsapp`).toBe(
        'unrecognised',
      )
    }
  })
})

describe('usableMessageId (AC-12, AC-12a, AC-13)', () => {
  it('answers the id for an ordinary WhatsApp send', () => {
    expect(usableMessageId(result({ message_id: '3EB0B430' }))).toBe('3EB0B430')
    expect(usableMessageId(result({ message_id: '3EB0B430', channel: 'whatsapp' }))).toBe(
      '3EB0B430',
    )
  })

  it('RULE: an SMS result yields no id, however well-formed the id looks', () => {
    // An SMS delivery writes no WhatsApp message row. The value is the carrier's
    // own reference and works with no message endpoint, so a reply, reaction,
    // forward or revoke built on it fails.
    expect(usableMessageId(result({ message_id: '3EB0B430', channel: 'sms' }))).toBeNull()
    expect(usableMessageId(result({ message_id: 'carrier-4711', channel: 'sms' }))).toBeNull()
  })

  it('yields no id for an unrecognised channel either', () => {
    expect(
      usableMessageId(result({ message_id: '3EB0B430', channel: 'carrier-pigeon' })),
    ).toBeNull()
  })

  it('answers null for an absent or blank id on a WhatsApp send', () => {
    expect(usableMessageId(result({ message_id: '' }))).toBeNull()
    expect(usableMessageId(result({ message_id: '   ' }))).toBeNull()
    expect(usableMessageId({ status: 'ok' } as SendMessageResult)).toBeNull()
  })
})

describe('carrierReference (AC-13, AC-13a)', () => {
  it('is empty for a WhatsApp result — there is no carrier reference to show', () => {
    expect(carrierReference(result({ message_id: '3EB0B430' }))).toBe('')
    expect(carrierReference(result({ message_id: '3EB0B430', channel: 'whatsapp' }))).toBe('')
  })

  it('returns the reference for an SMS result', () => {
    expect(carrierReference(result({ message_id: 'carrier-4711', channel: 'sms' }))).toBe(
      'carrier-4711',
    )
  })

  it('RULE: a bidi override is stripped before the reference is rendered', () => {
    // Gateway-chosen text landing in this app's own chrome beside a sentence
    // about what happened to somebody's message. React escapes HTML; it does not
    // neutralise U+202E, which reorders what is rendered around it.
    expect(carrierReference(result({ message_id: 'carrier‮4711', channel: 'sms' }))).toBe(
      'carrier4711',
    )
    expect(carrierReference(result({ message_id: '⁦ref⁩', channel: 'sms' }))).toBe('ref')
  })

  it('caps a long reference', () => {
    const long = 'x'.repeat(MAX_CARRIER_REFERENCE + 40)
    const capped = carrierReference(result({ message_id: long, channel: 'sms' }))
    expect(capped).toHaveLength(MAX_CARRIER_REFERENCE + 1)
    expect(capped.endsWith('…')).toBe(true)
  })

  it('answers the empty string for an absent id — a documented, ordinary outcome', () => {
    // "The WhatsApp message id — EXCEPT when channel is sms, where it is the
    // carrier's own reference and MAY BE EMPTY." So this is not an error state.
    expect(carrierReference(result({ message_id: '', channel: 'sms' }))).toBe('')
    expect(carrierReference({ status: 'ok', channel: 'sms' } as SendMessageResult)).toBe('')
  })
})

describe('shouldReadChatHistory (AC-14)', () => {
  it('is true for a WhatsApp send, so existing behaviour is unchanged', () => {
    expect(shouldReadChatHistory(result({}))).toBe(true)
    expect(shouldReadChatHistory(result({ channel: 'whatsapp' }))).toBe(true)
  })

  it('RULE: an SMS send re-reads nothing — there is no row to find', () => {
    expect(shouldReadChatHistory(result({ channel: 'sms' }))).toBe(false)
    expect(shouldReadChatHistory(result({ channel: 'carrier-pigeon' }))).toBe(false)
  })
})

describe('sendToast and deliveryNotice (AC-13, AC-13b, AC-15)', () => {
  it('a WhatsApp send keeps the message it has always shown, and gets no notice', () => {
    expect(sendToast(result({}))).toBe('Message sent')
    expect(deliveryNotice(result({}))).toBeNull()
    expect(deliveryNotice(result({ channel: 'whatsapp' }))).toBeNull()
  })

  it('RULE: the toast names the channel rather than asserting WhatsApp', () => {
    // Leaving a static "Message sent" while the panel underneath explains the
    // message went out over SMS gives two answers to one question, and the toast
    // is the one that gets read.
    expect(sendToast(result({ channel: 'sms' }))).toContain('SMS')
    expect(sendToast(result({ channel: 'sms' }))).toContain('not by WhatsApp')
    expect(sendToast(result({ channel: 'carrier-pigeon' }))).toContain('does not recognise')
  })

  it('returns the SMS notice for an SMS result and the unknown one otherwise', () => {
    expect(deliveryNotice(result({ channel: 'sms' }))).toBe(SMS_DELIVERY_NOTICE)
    expect(deliveryNotice(result({ channel: 'carrier-pigeon' }))).toBe(UNRECOGNISED_DELIVERY_NOTICE)
  })

  it('RULE: the SMS notice keeps all four facts, not just the first', () => {
    // They are only useful together, and the first is the only one that reads
    // like good news — which is exactly how a later edit shortens it down to
    // that one.
    const text = SMS_DELIVERY_NOTICE.description
    expect(text, 'says what happened').toContain('failed without reaching WhatsApp')
    expect(text, 'says the id belongs to the carrier and may be empty').toContain('may be empty')
    expect(text, 'says it is not a WhatsApp id and works nowhere').toContain(
      'not a WhatsApp message id',
    )
    expect(text).toContain('no reply, reaction, forward or revoke')
    expect(text, 'says why it will not appear in the conversation').toContain(
      'will not appear in the conversation',
    )
  })

  it('the unrecognised notice claims nothing about what happened', () => {
    expect(UNRECOGNISED_DELIVERY_NOTICE.description).toContain('nothing here can tell you')
    expect(UNRECOGNISED_DELIVERY_NOTICE.description).toContain('unusable')
  })
})
