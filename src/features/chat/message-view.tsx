import { memo, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Send } from 'lucide-react'
import { getChatMessages, type ChatInfo, type MessageInfo } from '@/api/chat'
import { sendText } from '@/api/send'
import { DeliveryNotice } from '@/components/shared/delivery-notice'
import { MessageMedia } from '@/features/chat/message-media'
import { ChatControls } from '@/features/chat/chat-controls'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { useActionMutation } from '@/hooks/use-action-mutation'
import { formatDate } from '@/lib/format'
import { sendToast, shouldReadChatHistory } from '@/lib/send-channel'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 30

function sortMessagesChronologically(messages: MessageInfo[]): MessageInfo[] {
  return [...messages].sort((left, right) => {
    return new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
  })
}

function dayKey(timestamp: string): string {
  return new Date(timestamp).toDateString()
}

/**
 * One message.
 *
 * **Memoised, and that is load-bearing rather than tidy.** The composer's `draft`
 * lives in `MessageView` below, so without this every one of the 30 rows — and
 * every `MessageMedia` inside them — re-rendered on each keystroke. `messages` is
 * `useMemo`'d on `query.data?.data`, so each `message` identity is stable between
 * renders, and the other two props are booleans and a string: the comparison
 * holds. This is the row treatment `source-policy.test.ts` already enforces for
 * `account-device-row` and `user-row`.
 *
 * It takes `canDownload` as a prop and calls no hook. A permission hook here
 * would be one store subscription per message for an answer that is identical for
 * all of them (study §13, rule 3).
 */
const MessageBubble = memo(function MessageBubble({
  message,
  canDownload,
  basePath,
}: {
  message: MessageInfo
  canDownload: boolean
  basePath: string
}) {
  const hasMedia = message.media_type && message.media_type !== ''
  return (
    <div className={cn('flex', message.is_from_me ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-xs',
          message.is_from_me ? 'bg-bubble-out rounded-br-sm' : 'bg-bubble-in rounded-bl-sm border',
        )}
      >
        {!message.is_from_me && (
          <p className="text-muted-foreground mb-0.5 font-mono text-xs">{message.sender_jid}</p>
        )}
        {message.content && <p className="break-words whitespace-pre-wrap">{message.content}</p>}
        {hasMedia && (
          <MessageMedia message={message} canDownload={canDownload} basePath={basePath} />
        )}
        {message.reactions && message.reactions.length > 0 && (
          <p className="mt-1 text-xs">{message.reactions.map((r) => r.emoji).join(' ')}</p>
        )}
        <p className="text-muted-foreground mt-1 text-right text-[10px]">
          {formatDate(message.timestamp)}
        </p>
      </div>
    </div>
  )
})

/**
 * One chat's messages, and the composer under them.
 *
 * **Every permission arrives as a prop and none is read here.** `draft` lives in
 * this component alongside the message list, so a hook here re-runs on every
 * keystroke; `src/pages/chats.tsx` reads all four values once, above. `basePath`
 * is here for the same reason — `message-media.tsx` used to call `useAppInfo()`
 * once per media-bearing row.
 *
 * **A send is not necessarily a WhatsApp message any more.** `POST /send/message`
 * is the only endpoint that can deliver by another channel, and when it does
 * there is no row in the chat storage to find — so the history is re-read only
 * when `shouldReadChatHistory` says the delivery was WhatsApp, and the toast
 * names the channel instead of asserting one. `@/lib/send-channel` owns both
 * decisions, and `message_id` is not readable from this file at all: the type
 * `sendText` returns omits it.
 */
export function MessageView({
  chat,
  mayCompose,
  mayWriteChats,
  mayDownloadMedia,
  basePath,
}: {
  chat: ChatInfo
  mayCompose: boolean
  mayWriteChats: boolean
  mayDownloadMedia: boolean
  basePath: string
}) {
  const queryClient = useQueryClient()
  const messageList = useRef<HTMLDivElement>(null)
  const [search, setSearch] = useState('')
  const [mediaOnly, setMediaOnly] = useState(false)
  const [offset, setOffset] = useState(0)
  const [draft, setDraft] = useState('')

  const query = useQuery({
    queryKey: ['chat-messages', chat.jid, { search, mediaOnly, offset }],
    queryFn: () =>
      getChatMessages(chat.jid, {
        search: search || undefined,
        media_only: mediaOnly || undefined,
        limit: PAGE_SIZE,
        offset,
      }),
    placeholderData: keepPreviousData,
  })

  const messages = useMemo(
    () => sortMessagesChronologically(query.data?.data ?? []),
    [query.data?.data],
  )
  const total = query.data?.pagination.total ?? 0

  useLayoutEffect(() => {
    const viewport = messageList.current?.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    )
    if (viewport) viewport.scrollTop = viewport.scrollHeight
  }, [chat.jid, messages])

  const sendMutation = useActionMutation(
    (message: string) => sendText({ phone: chat.jid, message }),
    {
      // Names the channel that actually delivered it. A static "Message sent" is
      // a claim about WhatsApp, and leaving it while the notice below explains
      // the message went out over SMS gives two answers to one question — the
      // toast being the one that is read.
      successMessage: sendToast,
      onSuccess: (result) => {
        setDraft('')
        // An SMS delivery writes NO WhatsApp message row, so refetching the
        // conversation for one asks for a row that does not exist and leaves the
        // user watching their message fail to appear. An absent `channel` still
        // answers `true`, so every response predating this field behaves exactly
        // as it did before.
        if (shouldReadChatHistory(result)) {
          void queryClient.invalidateQueries({ queryKey: ['chat-messages', chat.jid] })
        }
      },
    },
  )

  const onSend = (event: FormEvent) => {
    event.preventDefault()
    if (!draft.trim()) return
    // `mutation.data` outlives its send, so without this the previous message's
    // notice — which asserts a message will not appear in this conversation —
    // stays on screen through the next submit until that one resolves.
    sendMutation.reset()
    sendMutation.mutate(draft.trim())
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-start justify-between gap-2 border-b pb-3">
        <div className="min-w-0">
          <h2 className="truncate font-medium">{chat.name || chat.jid}</h2>
          <p className="text-muted-foreground truncate font-mono text-xs">{chat.jid}</p>
        </div>
        {/* Pin, archive and disappearing are all `chats.write`. Absent, never
            disabled: a disabled menu still announces that the capability
            exists. */}
        {mayWriteChats && <ChatControls chat={chat} />}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          className="sm:max-w-xs"
          placeholder="Search messages"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            setOffset(0)
          }}
        />
        <label className="text-muted-foreground flex items-center gap-2 text-sm">
          <Switch
            checked={mediaOnly}
            onCheckedChange={(value) => {
              setMediaOnly(value)
              setOffset(0)
            }}
          />
          Media only
        </label>
      </div>

      <div ref={messageList} className="min-h-0 flex-1">
        <ScrollArea className="bg-muted/40 size-full rounded-lg border p-3">
          {query.isLoading ? (
            <div className="flex justify-center p-6">
              <Loader2 className="text-muted-foreground size-5 animate-spin" />
            </div>
          ) : messages.length === 0 ? (
            <div className="text-muted-foreground flex flex-col gap-1 p-6 text-center text-sm">
              <p>No messages stored for this chat yet.</p>
              <p className="text-xs">
                Messages appear here as they are sent or received, and as WhatsApp history sync
                batches are processed after pairing. Contacts synced from your address book start
                without message history.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {messages.map((message, index) => {
                const showDateSeparator =
                  index === 0 || dayKey(message.timestamp) !== dayKey(messages[index - 1].timestamp)
                return (
                  <div key={message.id}>
                    {showDateSeparator && (
                      <div className="flex justify-center py-1">
                        <span className="bg-card text-muted-foreground rounded-full border px-3 py-0.5 text-xs shadow-xs">
                          {new Date(message.timestamp).toLocaleDateString(undefined, {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </span>
                      </div>
                    )}
                    <MessageBubble
                      message={message}
                      canDownload={mayDownloadMedia}
                      basePath={basePath}
                    />
                  </div>
                )
              })}
            </div>
          )}
        </ScrollArea>
      </div>

      <div className="text-muted-foreground flex items-center justify-between text-xs">
        <span>{total} messages</span>
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="sm"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            Newer
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            Older
          </Button>
        </div>
      </div>

      {/* The composer is `messages.send`, and it is absent without it rather than
          disabled — the seeded `user` role holds neither send permission, and a
          greyed-out box would still announce a capability they do not have. The
          message list above stays: reading a conversation is `chats.read`. */}
      {mayCompose && (
        <>
          {/* Rendered only for a delivery that was not WhatsApp; `null`
              otherwise, because an ordinary send needs no explanation. */}
          {sendMutation.data && <DeliveryNotice result={sendMutation.data} />}
          <form className="flex gap-2" onSubmit={onSend}>
            <Input
              placeholder="Type a message"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <Button type="submit" disabled={sendMutation.isPending || !draft.trim()}>
              {sendMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              Send
            </Button>
          </form>
        </>
      )}
    </div>
  )
}
