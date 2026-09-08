import type { SendMessageResult, SendMessageWire } from '@/api/send'
import type { Notice } from '@/lib/auth-messages'
import { displayText } from '@/lib/surfaces'

/**
 * The one rule `POST /send/message` adds to this app: **read `channel` before you
 * use `message_id`.**
 *
 * The reference states it as an obligation on the caller, and an obligation on
 * the caller is a rule that gets forgotten. So it is not documented here — it is
 * made unavailable. `@/api/send` exposes `SendMessageResult`, which is the wire
 * shape with `message_id` **omitted from the type**, and this module owns the
 * single cast that reads it back. Everywhere else in the app,
 * `result.message_id` is a compile error, and `tsc -b` is what enforces the rule
 * rather than a reviewer noticing.
 *
 * Why that matters concretely: an SMS delivery writes **no WhatsApp message row**.
 * The id it reports is the carrier's own reference, it may be empty, and it works
 * with no message endpoint — so a reply, a reaction, a forward or a revoke built
 * on it fails, and waiting for the message to appear in `GET /chat/{jid}/messages`
 * waits forever.
 *
 * Pure: no store, no React, no axios.
 */

/**
 * Which channel delivered the message.
 *
 * **`unrecognised` is the whole point of this function.** The obvious spelling —
 * `channel === 'sms' ? 'sms' : 'whatsapp'` — fails *open*: the first time this
 * server reports a third channel, every value this dashboard does not know is
 * read as WhatsApp, and a foreign reference is handed back as a WhatsApp message
 * id. So only two inputs answer `whatsapp`: the field being **absent**, which is
 * what every other `/send/*` endpoint means by omitting it and what the reference
 * says an ordinary send reports, and the **exact literal**. Everything else is
 * treated as not-WhatsApp, which is the direction that costs a line of copy
 * rather than a wrong action.
 *
 * `SendMessageWire.channel` is typed `string` rather than a two-value union for
 * the same reason: the server owns that enum, and a closed type would make the
 * third branch unreachable to the type checker while leaving it perfectly
 * reachable at runtime.
 */
export type DeliveryChannel = 'whatsapp' | 'sms' | 'unrecognised'

export function deliveryChannel(result: SendMessageResult): DeliveryChannel {
  const channel = result.channel
  if (channel === undefined || channel === 'whatsapp') return 'whatsapp'
  if (channel === 'sms') return 'sms'
  return 'unrecognised'
}

/**
 * The WhatsApp message id, or `null` when there is not one.
 *
 * The only sanctioned reader of `message_id` in this application. The cast is
 * this module's licence and lives on exactly one line; the source policy fails
 * the build if a second appears.
 *
 * `null` for three separate reasons that collapse into one answer for the caller:
 * the channel was not WhatsApp, the field was absent, or it was blank. A caller
 * that wants an id gets one only when acting on it can work.
 */
export function usableMessageId(result: SendMessageResult): string | null {
  if (deliveryChannel(result) !== 'whatsapp') return null
  const id = (result as SendMessageWire).message_id ?? ''
  return id.trim() === '' ? null : id
}

/**
 * The longest carrier reference this app renders.
 *
 * Short, because it is an operator-facing identifier rather than a body of text,
 * and because the value comes from a third party — the SMS gateway — through the
 * server. Defined here rather than imported so the cap for this class of string
 * has one owner.
 */
export const MAX_CARRIER_REFERENCE = 64

/**
 * The identifier of a non-WhatsApp delivery, made safe to render.
 *
 * **Gateway-supplied text landing in this app's own chrome**, beside a sentence
 * stating what happened to somebody's message — which is exactly the position
 * `@/lib/surfaces` describes for an account name, and it gets the same treatment:
 * `displayText` strips Unicode control and format characters (the bidi overrides
 * `U+202A..202E` and the isolates `U+2066..2069` above all, which reorder what is
 * rendered around them) and caps the length. React escapes HTML; it does not
 * neutralise `U+202E`.
 *
 * The empty string for a WhatsApp result, because there is no carrier reference
 * to show — and the empty string for a missing id, because an SMS delivery
 * legitimately reports none and the caller renders a cell either way.
 */
export function carrierReference(result: SendMessageResult): string {
  if (deliveryChannel(result) === 'whatsapp') return ''
  return displayText((result as SendMessageWire).message_id, MAX_CARRIER_REFERENCE)
}

/**
 * Should the chat history be re-read after this send?
 *
 * Only for a WhatsApp delivery. An SMS writes no row in the chat storage, so
 * invalidating `['chat-messages', jid]` for one is a refetch of a conversation
 * that will not contain the message — and the user watches their message fail to
 * appear with no explanation available anywhere.
 *
 * An absent `channel` answers `true` through `deliveryChannel`, so every response
 * that predates this field, and every deployment without the fallback, behaves
 * exactly as it did before.
 */
export function shouldReadChatHistory(result: SendMessageResult): boolean {
  return deliveryChannel(result) === 'whatsapp'
}

/**
 * What the success toast says.
 *
 * A static "Message sent" is a claim about WhatsApp. Leaving it in place while a
 * panel underneath explains the message went out over SMS is two answers to one
 * question, and the toast is the one the user reads.
 */
export function sendToast(result: SendMessageResult): string {
  switch (deliveryChannel(result)) {
    case 'sms':
      return 'Delivered by SMS, not by WhatsApp'
    case 'unrecognised':
      return 'Delivered by a channel this dashboard does not recognise'
    default:
      return 'Message sent'
  }
}

/**
 * What the screen says about a delivery that was not WhatsApp, or `null` when
 * there is nothing to say.
 *
 * `null` for a WhatsApp send is a real answer and not a placeholder: an ordinary
 * send needs no explanation, and a notice on every message would train the reader
 * to stop looking at it.
 *
 * The SMS text keeps four facts in one place because they are only useful
 * together: what happened, that the identifier belongs to the carrier and may be
 * empty, that it is **not** a WhatsApp message id and works with no message
 * endpoint, and that the message will not appear in the conversation. Splitting
 * them would let a future edit shorten the screen down to the first one, which is
 * the only one that reads like good news.
 */
export const SMS_DELIVERY_NOTICE: Notice = {
  title: 'Delivered by SMS, not by WhatsApp',
  description:
    'Every WhatsApp channel available to this account failed without reaching WhatsApp, so the text was delivered through the deployment’s SMS gateway instead. The identifier below is the carrier’s own reference and may be empty — it is not a WhatsApp message id, it works with no message endpoint, and no reply, reaction, forward or revoke can be built on it. This message will not appear in the conversation, because an SMS delivery writes no WhatsApp message row.',
}

/**
 * The same shape for a channel this dashboard has never heard of.
 *
 * It exists because `deliveryChannel` fails safe, and a state that can be reached
 * needs something to render. It claims nothing about what happened — it cannot —
 * and withholds the id for the same reason: an identifier from an unknown channel
 * is not known to work anywhere.
 */
export const UNRECOGNISED_DELIVERY_NOTICE: Notice = {
  title: 'Delivered by a channel this dashboard does not recognise',
  description:
    'The server reported a delivery channel this version of the dashboard does not know. The message was accepted, but nothing here can tell you whether it reached WhatsApp, so the identifier is treated as unusable and the conversation is not re-read. Update the dashboard, or ask the operator which channel this deployment reports.',
}

export function deliveryNotice(result: SendMessageResult): Notice | null {
  switch (deliveryChannel(result)) {
    case 'sms':
      return SMS_DELIVERY_NOTICE
    case 'unrecognised':
      return UNRECOGNISED_DELIVERY_NOTICE
    default:
      return null
  }
}
