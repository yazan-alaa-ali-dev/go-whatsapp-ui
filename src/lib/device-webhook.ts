import type { DeviceWebhookConfig, UpdateDeviceWebhookPayload } from '@/api/devices'
import { toApiError } from '@/lib/api-error'

/**
 * Every decision the device webhook surface makes, as a function of its
 * arguments.
 *
 * **This module exists because two different operations look like "turn the
 * webhook off", and the product got it wrong until this ticket.** The dialog
 * this replaces told the operator to "leave the URL empty and save to disable
 * the webhook", which is the one thing the reference explicitly warns against:
 *
 * - Emptying `webhook_url` through `PATCH /devices/{id}/webhook` is a
 *   **deletion**. It erases the URL, the secret and the event list, and the
 *   device's events then fall back to the deployment-wide webhook list — so
 *   events keep going out, just somewhere else, to an endpoint the operator did
 *   not choose for this customer.
 * - `PATCH /devices/{id}/webhook/enabled` with `false` is **silence**. Nothing
 *   is delivered, nothing falls back, and the AI agent bridge is not called, so
 *   no automatic reply reaches the customer.
 *
 * One of those loses the configuration and leaks the events; the other keeps
 * everything and stops the delivery. The sentences below are the product's only
 * defence against choosing the wrong one, so they are constants with tests
 * rather than copy inside JSX — copy inside JSX is copy that drifts from the
 * request beside it.
 *
 * Pure: no store, no React, no axios instance.
 */

/**
 * What saving this form does to the stored configuration.
 *
 * One function, called by both the warning and the request, so the two cannot
 * disagree. Two independent `url.trim() === ''` checks in a component is exactly
 * how a UI ends up warning about one thing and sending another.
 */
export function webhookSaveEffect(url: string): 'clear' | 'set' {
  return url.trim() === '' ? 'clear' : 'set'
}

/**
 * What an empty URL destroys, in the words the specification requires.
 *
 * A constant rather than a string in a dialog because the test asserts the two
 * facts it must carry — that three stored values are erased, and that events
 * then go *somewhere else* rather than stopping — and a paraphrase in a
 * component would satisfy neither.
 */
export const CLEARS_WEBHOOK_WARNING =
  'Saving an empty URL deletes this device’s webhook configuration: the URL, the signing secret and the event list are all erased. Events do not stop — this device’s events then fall back to the deployment-wide webhook list, so they keep going out, to an endpoint you did not choose for this customer. To stop delivery without losing anything, switch delivery off instead.'

/**
 * What switching delivery off actually does — all four consequences.
 *
 * The fourth is the one nobody expects and the reason this list is data: an
 * operator disabling a webhook to stop *notifications* also stops the AI agent
 * bridge, so the customer stops receiving automatic replies. That is a change in
 * what the customer experiences, not an internal detail, and it belongs on
 * screen next to the switch.
 */
export const DISABLED_MEANS = [
  'Nothing is delivered to this device’s webhook URL.',
  'Nothing falls back to the deployment-wide webhook either — switching delivery off means silence, not redirection.',
  'The AI agent bridge is not called for this device, so no automatic reply is sent to the customer.',
  'Incoming messages are still received and stored, and you can still reply by hand.',
] as const

/** What re-enabling does, which is the half an operator hesitates over. */
export const ENABLING_RESUMES =
  'Switching delivery back on resumes it to the same URL, with the same signing secret and the same event list, on the first message that arrives afterwards. There is no restart, no re-pairing, and nothing to re-enter.'

/**
 * What skipping TLS verification costs.
 *
 * The field was already on this form with a bare label. Every other switch here
 * now states its consequence, and leaving the one that turns off peer
 * authentication as the exception would be the odd omission: with it on, this
 * device's events — signed with the secret above, and carrying the customer's
 * message content — go to whatever presents itself at that address.
 */
export const INSECURE_SKIP_VERIFY_MEANS =
  'With this on, the server does not check that the certificate at the webhook URL belongs to that host. This device’s events — the customer’s message content, signed with the secret above — are then delivered to whatever answers at that address. Turn it on only for an endpoint whose certificate you control and cannot fix.'

/**
 * A sentence about the URL's scheme, or `null`.
 *
 * **A notice, never a refusal.** An endpoint reachable only inside a private
 * network is a legitimate deployment, and the server is the authority on what it
 * accepts; a client-side rejection here would block a working configuration to
 * make a point. What the operator is owed is the consequence.
 *
 * It deliberately does not reach for `@/lib/url`, which normalises the *server
 * base URL* and answers a different question with different rules. A string that
 * is not a URL at all gets the same notice as `http:` — the server will reject
 * it, and guessing which malformed strings it would have taken is how a client
 * refuses input the server would have accepted.
 */
export function webhookUrlNotice(url: string): string | null {
  const trimmed = url.trim()
  if (trimmed === '') return null
  if (/^https:\/\//i.test(trimmed)) return null
  return 'This URL is not https. Events for this device — the customer’s message content — will be sent over a connection that anyone on the path can read. Use https unless this endpoint is reachable only inside a private network.'
}

/**
 * Is webhook delivery on for this device, and did the server actually say so?
 *
 * **An absent field reads as `true`.** The reference documents
 * `webhook_enabled` as always present — a device that has never been disabled
 * reports `true`, and so does a device with no webhook configuration at all,
 * because absence of configuration is not the same as being silenced — but a
 * deployment predating the switch omits it, and reading an omission as `false`
 * would tell an operator their customer's webhook is silenced when it is not.
 *
 * **And the inference is reported rather than hidden**, which is the honest
 * form of a fail-open on a delivery-state display: `reported: false` means this
 * value is what we assume, not what the server said, and the switch labels it
 * that way instead of asserting it.
 *
 * Note what this is *not* about: a response that has not arrived. The rule
 * concerns a missing **field**, not a missing **read** — passing `undefined`
 * because a query is still in flight would render "on" for the length of the
 * load, on the one screen that exists to stop exactly that confusion. The caller
 * renders no switch until the read resolves.
 */
export function webhookEnabledFrom(config: DeviceWebhookConfig): {
  enabled: boolean
  reported: boolean
} {
  const reported = config.webhook_enabled !== undefined
  return { enabled: config.webhook_enabled ?? true, reported }
}

/**
 * The `PATCH /devices/{id}/webhook` body.
 *
 * `webhook_url` is always present: it is a required field whose empty value is
 * *meaningful*, so the payload-cleaning helper in `@/api/request` — which drops
 * `undefined` **and** `''` — would turn a deletion into a no-op body. This
 * module builds the payload literally for the same reason `src/api/accounts.ts`
 * refuses that helper across its whole surface.
 *
 * The secret travels back unchanged when the operator did not replace it. The
 * reference does not say what an *omitted* `webhook_secret` does to the stored
 * one, and guessing "it is kept" would silently destroy a customer's signing
 * secret on every unrelated save if the guess were wrong. Round-tripping the
 * value is the only behaviour that is safe under both readings.
 */
export function webhookPayloadFrom(fields: {
  url: string
  secret: string
  events: string
  insecureSkipVerify: boolean
}): UpdateDeviceWebhookPayload {
  return {
    webhook_url: fields.url.trim(),
    webhook_secret: fields.secret,
    webhook_events: fields.events.trim(),
    webhook_insecure_skip_verify: fields.insecureSkipVerify,
  }
}

/** The sentence a failed save gets when the server's own text may not be shown. */
export const WEBHOOK_SAVE_FAILED_REDACTED =
  'The webhook was not saved. The server’s reason is not shown here because this request carried the signing secret, and a rejection can quote the field it rejected. Check the URL and the event list and try again.'

/**
 * May the server's own text be rendered for this failure?
 *
 * The `createFailure` / `CREATE_FAILED_REDACTED` shape from
 * `@/lib/account-lifecycle`, applied to the same hazard one surface over: a
 * `4xx` rejecting this payload may echo the field it rejected, and this payload
 * carries a signing secret. So no server text is rendered for a failed save.
 *
 * A failure with no response behind it — `status: 0`, meaning offline, DNS, or a
 * cancelled request — keeps its text: there is no response to have echoed
 * anything, and discarding the only diagnostic available would make an
 * unreachable server indistinguishable from a rejected secret.
 */
export function webhookSaveFailure(error: unknown): 'server' | 'redacted' {
  return toApiError(error).status >= 400 ? 'redacted' : 'server'
}
