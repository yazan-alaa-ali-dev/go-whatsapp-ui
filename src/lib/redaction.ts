/**
 * The masked-field rule (reference §09) — the single largest source of silent
 * bugs in this migration, according to §11's own list.
 *
 * **Masking in this backend is deletion of the key.** Not `null`, not `false`,
 * not an empty string. When a principal lacks the permission for a field, the
 * field is simply not in the JSON. That is deliberate: a permanent
 * `has_debug: false` would itself be a declaration that a field exists which the
 * user may not see, so the backend removes the distinction between "there are no
 * diagnostics" and "you may not see them" — and it removes it for the UI too.
 *
 * ```ts
 * // WRONG — a privileged user with no diagnostics looks identical to this
 * if (message.has_debug === false) showNothing()
 * // WRONG — "sent_by" is absent, not empty
 * const sender = message.sent_by || 'unknown'
 * // RIGHT — presence of the KEY is the signal
 * if (hasField(message, 'sent_by')) …
 * ```
 *
 * **A missing field is never an error.** No 403 accompanies it and none should
 * be shown. §09's instruction is to render the diagnostics, transcript and
 * origin surfaces conditionally from `permissions[]`, and then to treat an
 * absent key as "not available" with no message at all — because the backend
 * will not tell the two apart on the UI's behalf.
 *
 * **Presence is not a grant.** `hasField(m, 'sent_by')` reads like "I hold
 * `messages.origin.read`", and it is not: it is a statement about one payload,
 * from one request, at one moment. It must never gate an action, a mutation or
 * an admin affordance — that is what `./permissions` is for, and the two are
 * different authorities. The boundary is executable rather than stylistic: this
 * module may not import `./permissions`, `./permissions` may not import this
 * one, and `./source-policy.test.ts` fails the build if either ever does.
 */

/**
 * Every field §09 lists as maskable. `sent_via` is deliberately **not** here —
 * see `hasDiagnostics` below and `MessageInfo` in `@/api/chat`.
 */
export const MASKED_FIELDS = [
  'metadata_debug',
  'has_debug',
  'transcript',
  'transcript_language',
  'transcript_status',
  'sent_by',
  'sent_by_name',
] as const

/** The maskable field names, as a closed union. */
export type MaskedField = (typeof MASKED_FIELDS)[number]

/**
 * The sanctioned spelling of the §09 rule: does the object carry this key?
 *
 * Two things about this signature are the point of it.
 *
 * **`K extends MaskedField`, not `K extends string`.** A typo would otherwise
 * compile and report "absent" forever, silently and permanently hiding a field
 * — the same class of bug the closed `Permission` union prevents one module
 * over. `hasField(message, 'sent_bt')` does not compile.
 *
 * **It is a type predicate.** With a plain `boolean`, TypeScript still types
 * `message.sent_by` as `string | undefined` inside the guarded branch, and the
 * developer reaches for `!` or `?? 'unknown'` — the exact idiom this module
 * exists to ban. Narrowing the branch makes the banned fallback unnecessary
 * rather than merely discouraged.
 */
export function hasField<K extends MaskedField>(
  value: unknown,
  key: K,
): value is Record<K, unknown> {
  return typeof value === 'object' && value !== null && key in value
}

/**
 * Does this message carry diagnostics?
 *
 * `has_debug` is the one field that is **both** maskable *and* `omitempty`, so
 * even for a principal entitled to see it, absence means "there are no
 * diagnostics" — which is what an explicit `false` used to mean. `=== true` is
 * therefore the only correct test, and an explicit `false` must never be
 * expected (§09).
 *
 * This is a separate function rather than a `hasField(m, 'has_debug')` call
 * because those two ask different questions: the key can be present *and* the
 * answer still be "no diagnostics".
 *
 * The signature is generic rather than a bare `{ has_debug?: boolean }` because
 * that shape is a *weak type*: TypeScript rejects an object that shares no
 * property with it — which is precisely the redacted payload this function
 * exists to answer for, the one with no `has_debug` key at all.
 */
export function hasDiagnostics<T extends object>(message: T & { has_debug?: boolean }): boolean {
  return message.has_debug === true
}
