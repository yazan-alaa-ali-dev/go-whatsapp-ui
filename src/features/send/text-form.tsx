import { useState, type FormEvent } from 'react'
import { sendText, textRequest } from '@/api/send'
import { FormActions } from '@/components/shared/curl-dialog'
import { DeliveryNotice } from '@/components/shared/delivery-notice'
import { ResultPanel } from '@/components/shared/result-panel'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useActionMutation } from '@/hooks/use-action-mutation'
import { deliveryChannel, sendToast } from '@/lib/send-channel'
import { useRecipientJid } from '@/stores/recipient'

/**
 * The one send form whose result may not be a WhatsApp message.
 *
 * `POST /send/message` is the only endpoint that can deliver by another channel,
 * so this is the only form that reads one. When it does, the `ResultPanel` is
 * replaced rather than accompanied: that panel is a `JSON.stringify` of the whole
 * result, and its `message_id` line is precisely the value somebody would paste
 * into the "Act on a message" tab beside it — where a carrier reference works
 * with no endpoint at all.
 */
export function SendTextForm() {
  const jid = useRecipientJid()
  const [message, setMessage] = useState('')
  const [replyId, setReplyId] = useState('')

  // Names the channel that delivered it rather than asserting WhatsApp.
  const mutation = useActionMutation(sendText, { successMessage: sendToast })

  const payload = {
    phone: jid,
    message,
    reply_message_id: replyId || undefined,
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    // The previous result outlives its send, and a notice asserting a message
    // will not appear must not sit above a send that has not answered yet.
    mutation.reset()
    mutation.mutate(payload)
  }

  // `undefined` before the first send; the notice and the dump are mutually
  // exclusive, so exactly one of them describes the result on screen.
  const wentByWhatsApp =
    mutation.data === undefined || deliveryChannel(mutation.data) === 'whatsapp'

  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <div className="flex flex-col gap-2">
        <Label htmlFor="text-message">Message</Label>
        <Textarea
          id="text-message"
          rows={4}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          required
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="text-reply">Reply to message ID (optional)</Label>
        <Input
          id="text-reply"
          value={replyId}
          onChange={(event) => setReplyId(event.target.value)}
        />
      </div>
      <FormActions
        submitLabel="Send message"
        pending={mutation.isPending}
        disabled={!jid}
        request={textRequest(payload)}
      />
      {wentByWhatsApp ? (
        <ResultPanel result={mutation.data} />
      ) : (
        <DeliveryNotice result={mutation.data!} />
      )}
    </form>
  )
}
