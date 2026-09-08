import { useRef, useState } from 'react'
import { MessagesSquare } from 'lucide-react'
import { ChatList } from '@/features/chat/chat-list'
import { MessageView } from '@/features/chat/message-view'
import { Card } from '@/components/ui/card'
import { PageHeader } from '@/components/shared/page-header'
import { useAppInfo } from '@/hooks/use-app-info'
import { DeviceGuard, useSelectedDevice } from '@/hooks/use-device-guard'
import { useHasPermission } from '@/hooks/use-permissions'
import { PERMISSIONS } from '@/lib/permissions'
import type { ChatInfo } from '@/api/chat'

/**
 * `/chats` — and the height at which this screen's permissions are answered.
 *
 * **Every guard for the message view is read here, and none inside it.**
 * `MessageView` holds the composer's `draft` in the same component that renders
 * the message rows, so anything placed in that subtree re-runs on **every
 * keystroke**, and `MessageMedia` is instantiated per row. A `useHasPermission`
 * there would be one store subscription re-evaluated per character, or one per
 * message; here it is three subscriptions for the life of the page, and the
 * answers travel down as booleans (`src/components/shared/can.tsx` documents this
 * rule and names this exact file as the reason it exists).
 *
 * `base_path` is hoisted for the same reason and is not a permission at all:
 * `message-media.tsx` called `useAppInfo()` once per media-bearing message, which
 * is a query observer and a store subscription per row for one shared,
 * `staleTime: Infinity` answer.
 *
 * All four sit **above** the `if (!device)` return — they are hooks, and a
 * conditional call is a rules-of-hooks violation rather than an optimisation.
 *
 * Hiding a control is an affordance, never enforcement: the server guards every
 * one of these routes and the message list itself is deliberately **not** guarded
 * on `messages.read`, which grants downloading media only (reference §04).
 */
export default function ChatsPage() {
  const device = useSelectedDevice()
  const mayCompose = useHasPermission(PERMISSIONS.MESSAGES_SEND)
  const mayWriteChats = useHasPermission(PERMISSIONS.CHATS_WRITE)
  // `messages.read` is a misnomer fixed in the catalogue: it grants
  // GET /message/{id}/download and nothing else. Reading the messages themselves
  // comes with `chats.read`, so the list below is not guarded on it.
  const mayDownloadMedia = useHasPermission(PERMISSIONS.MESSAGES_READ)
  const { data: appInfo } = useAppInfo()
  const [selected, setSelected] = useState<ChatInfo | null>(null)
  const messagePane = useRef<HTMLDivElement>(null)

  // On stacked layouts the message pane sits below the fold, so bring it into view.
  const handleSelect = (chat: ChatInfo) => {
    setSelected(chat)
    messagePane.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  if (!device) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Chats" description="Stored conversations for this device." />
        <DeviceGuard />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 lg:h-[calc(100svh-8.5rem)]">
      <PageHeader title="Chats" description="Stored conversations for this device." />
      <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[320px_1fr]">
        <Card className="h-[24rem] overflow-hidden p-3 lg:h-auto lg:min-h-0">
          <ChatList selectedJid={selected?.jid ?? null} onSelect={handleSelect} />
        </Card>
        <Card
          ref={messagePane}
          className="h-[calc(100svh-9rem)] min-h-[26rem] overflow-hidden p-3 lg:h-auto lg:min-h-0"
        >
          {selected ? (
            <MessageView
              key={selected.jid}
              chat={selected}
              mayCompose={mayCompose}
              mayWriteChats={mayWriteChats}
              mayDownloadMedia={mayDownloadMedia}
              basePath={appInfo?.base_path ?? ''}
            />
          ) : (
            <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2">
              <MessagesSquare className="size-8" />
              <p className="text-sm">Select a chat to view its messages</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
