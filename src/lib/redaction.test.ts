import { describe, expect, it } from 'vitest'
import { hasDiagnostics, hasField, MASKED_FIELDS } from './redaction'

/**
 * The two payloads §09 describes, built the way the backend builds them: the
 * unprivileged one does not carry the keys at all. Writing `sent_by: undefined`
 * here would defeat the whole file — `'sent_by' in message` would be true.
 */
const privileged = {
  id: 'msg_01',
  content: 'hello',
  sent_via: 'api',
  sent_by: 'usr_07',
  sent_by_name: 'Layla',
  has_debug: true,
  transcript: 'a transcript',
}

const redacted = {
  id: 'msg_01',
  content: 'hello',
  sent_via: 'api',
}

describe('a masked field disappears silently (AC-14, AC-15, TC-7)', () => {
  it('reports the key as present for a principal who may see it', () => {
    expect(hasField(privileged, 'sent_by')).toBe(true)
    expect(hasField(privileged, 'sent_by_name')).toBe(true)
  })

  it('reports the key as absent — not empty, not null — for one who may not', () => {
    expect(hasField(redacted, 'sent_by')).toBe(false)
    expect(hasField(redacted, 'transcript')).toBe(false)
    // And nothing threw: an absent key is not an error, and no 403 came with
    // it. §09's instruction is to present it as "not available", silently.
    expect(() => hasField(redacted, 'metadata_debug')).not.toThrow()
  })

  it('distinguishes an absent key from a present falsy value', () => {
    // The distinction the whole rule rests on. `message.sent_by || 'unknown'`
    // cannot see it; `'sent_by' in message` can.
    expect(hasField({ ...redacted, sent_by: '' }, 'sent_by')).toBe(true)
    expect(hasField(redacted, 'sent_by')).toBe(false)
  })

  it('tests the KEY, not the value — a key holding undefined is still present', () => {
    // This is the assertion that makes the rule a rule. Mutation testing found
    // it missing: `value[key] !== undefined` passed every other case in this
    // file, and it is the single most likely way somebody would rewrite this
    // function while believing they had kept its meaning.
    //
    // JSON cannot produce this shape, but JavaScript can — a spread that sets
    // the field explicitly, or an object built by hand — and a value test would
    // report an outgoing message as redacted when it is not.
    expect(hasField({ sent_by: undefined }, 'sent_by')).toBe(true)
    expect(hasField({ has_debug: undefined }, 'has_debug')).toBe(true)
    expect(hasField({}, 'sent_by')).toBe(false)
  })

  it('narrows the type, so the guarded branch needs no fallback', () => {
    // The reason it is a type predicate rather than a boolean: without this,
    // `sent_by` stays `string | undefined` inside the branch and the developer
    // reaches for `?? 'unknown'` — the idiom §09 bans.
    const message: unknown = privileged
    if (hasField(message, 'sent_by')) {
      expect(String(message.sent_by)).toBe('usr_07')
    } else {
      throw new Error('expected the key to be present')
    }
  })

  it('does not throw on a non-object', () => {
    expect(hasField(null, 'sent_by')).toBe(false)
    expect(hasField(undefined, 'sent_by')).toBe(false)
    expect(hasField('sent_by', 'sent_by')).toBe(false)
  })

  it('lists exactly the seven fields §09 names', () => {
    expect([...MASKED_FIELDS]).toEqual([
      'metadata_debug',
      'has_debug',
      'transcript',
      'transcript_language',
      'transcript_status',
      'sent_by',
      'sent_by_name',
    ])
  })
})

describe('has_debug carries omitempty (AC-16, TC-8)', () => {
  it('reads an absent key and an explicit false as the same thing', () => {
    // The point of the criterion: even for a principal entitled to see it,
    // absence means "no diagnostics" — which is what `false` used to mean. Both
    // answer no, and nothing in the codebase may expect an explicit `false`.
    expect(hasDiagnostics(redacted)).toBe(false)
    expect(hasDiagnostics({ has_debug: false })).toBe(false)
  })

  it('is true only for an explicit true', () => {
    expect(hasDiagnostics(privileged)).toBe(true)
    expect(hasDiagnostics({ has_debug: true })).toBe(true)
  })

  it('asks a different question from key presence', () => {
    // Why it is a separate function: the key can be present and the answer
    // still be "no diagnostics", so `hasField(m, 'has_debug')` is not a
    // substitute for it.
    const present = { has_debug: false }
    expect(hasField(present, 'has_debug')).toBe(true)
    expect(hasDiagnostics(present)).toBe(false)
  })
})

describe('sent_via is never masked (AC-17, TC-9)', () => {
  it('is present on a payload whose origin identity was redacted', () => {
    // An automated reply can always be told from a human one, even without
    // messages.origin.read (§09). Only the human identity behind it is hidden.
    expect(redacted.sent_via).toBe('api')
    expect(hasField(redacted, 'sent_by')).toBe(false)
  })

  it('is not in the maskable list', () => {
    expect(MASKED_FIELDS).not.toContain('sent_via')
    // And the compiler agrees: `MessageInfo.sent_via` is required, so this is
    // a fact the type holds rather than a sentence in a comment. `hasField(m,
    // 'sent_via')` does not compile — the key is not a MaskedField.
  })
})
