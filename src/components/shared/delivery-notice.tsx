import { Radio } from 'lucide-react'
import { IdText } from '@/components/shared/id-text'
import { carrierReference, deliveryNotice } from '@/lib/send-channel'
import type { SendMessageResult } from '@/api/send'

/**
 * What a text send that did not go out over WhatsApp says for itself.
 *
 * `null` for an ordinary WhatsApp send, and that is the common case: a notice on
 * every message would train the reader to stop looking at it, and there is
 * nothing to explain when the message went where it was supposed to.
 *
 * **The identifier is rendered through `carrierReference`, never raw.** It is
 * text a third-party SMS gateway chose, arriving through the server into this
 * app's own chrome, immediately beside a sentence stating what happened to
 * somebody's message — the same position `@/lib/surfaces` describes for an
 * account name, and it gets the same strip-and-cap. React escapes HTML; it does
 * not neutralise a bidi override, which would reorder the sentence around it.
 *
 * It is a text child and nothing else: no `href`, no copy action, no input. An
 * identifier that works with no endpoint has nowhere useful to be pasted, and
 * offering to move it somewhere would suggest otherwise.
 *
 * Both text-send surfaces render this — the chat composer and the messaging
 * compose form — so the sentence exists once. Shortening it is the edit to
 * refuse: the four facts in it are only useful together, and the first of them is
 * the only one that reads like good news.
 */
export function DeliveryNotice({ result }: { result: SendMessageResult }) {
  const notice = deliveryNotice(result)
  if (!notice) return null

  const reference = carrierReference(result)

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
      <p className="flex items-center gap-2 font-medium">
        <Radio className="size-4 shrink-0 text-amber-600 dark:text-amber-500" />
        {notice.title}
      </p>
      <p className="text-muted-foreground">{notice.description}</p>
      {/* An empty reference is a documented, ordinary outcome rather than an
          error — an SMS delivery may report none at all — so it renders a
          sentence instead of a value, and never an error state. */}
      {reference === '' ? (
        <p className="text-muted-foreground text-xs">The carrier reported no reference.</p>
      ) : (
        <IdText value={reference} />
      )}
    </div>
  )
}
