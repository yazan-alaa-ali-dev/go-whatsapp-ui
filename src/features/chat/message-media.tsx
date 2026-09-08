import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, Loader2, Paperclip } from 'lucide-react'
import { downloadMedia } from '@/api/message'
import { Button } from '@/components/ui/button'
import { toApiError } from '@/lib/api-error'
import { formatBytes } from '@/lib/format'
import { rerootServerUrl } from '@/lib/url'
import type { MessageInfo } from '@/api/chat'

/**
 * Lazily downloads media for a message and renders it inline once fetched.
 *
 * **Rendered per row, so it calls no hook it can be given instead.** `useAppInfo()`
 * used to live here, which was one query observer and one store subscription for
 * every media-bearing message in the list, re-evaluated on every keystroke in the
 * composer above it. `basePath` now arrives as a prop from `src/pages/chats.tsx`,
 * hoisted alongside the permission booleans for exactly the same reason.
 *
 * **`canDownload` is `messages.read`, which grants downloading media and nothing
 * else.** The permission is a documented misnomer (reference §04): reading the
 * messages themselves comes with `chats.read`, so the message list is not guarded
 * on it — doing that would hide every conversation from an ordinary user entitled
 * to see it.
 *
 * Without it the message still says it carries media, as static text. That is the
 * difference between hiding a *control* and hiding a *fact*: `media_type` and
 * `file_length` are fields of a row this principal already received, so the label
 * discloses nothing the server withheld — it just offers nothing to press.
 *
 * The gate is on the query's `enabled`, not only on the button. A hidden control
 * whose request still fires manufactures the 403 the guard existed to spare the
 * user.
 */
export function MessageMedia({
  message,
  canDownload,
  basePath,
}: {
  message: MessageInfo
  canDownload: boolean
  basePath: string
}) {
  const [open, setOpen] = useState(false)

  const query = useQuery({
    queryKey: ['media', message.id, message.chat_jid],
    queryFn: () => downloadMedia(message.id, message.chat_jid),
    // `canDownload` belongs here as well as in the early return below: `open` is
    // state, and a permission that changes under a component that already opened
    // one must not leave a request in flight.
    enabled: open && canDownload,
    staleTime: Infinity,
    retry: false,
  })

  if (!canDownload) {
    return (
      <p className="text-muted-foreground mt-1 flex items-center gap-1.5 text-xs">
        <Paperclip className="size-3.5" />
        {message.media_type}
        {message.file_length ? ` · ${formatBytes(message.file_length)}` : ''}
      </p>
    )
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" className="mt-1" onClick={() => setOpen(true)}>
        <Download className="size-3.5" />
        {message.media_type}
        {message.file_length ? ` · ${formatBytes(message.file_length)}` : ''}
      </Button>
    )
  }

  if (query.isLoading) {
    return <Loader2 className="text-muted-foreground mt-1 size-4 animate-spin" />
  }

  if (query.isError || !query.data) {
    return (
      <p className="text-destructive mt-1 text-xs">
        {query.error ? toApiError(query.error).message : 'Download failed'}
      </p>
    )
  }

  const src = rerootServerUrl(query.data.file_path, basePath)
  const type = message.media_type

  return (
    <div className="mt-1">
      {type === 'image' ? (
        <img src={src} alt={query.data.filename} className="max-h-64 rounded-md" />
      ) : type === 'video' ? (
        <video src={src} controls className="max-h-64 rounded-md" />
      ) : type === 'audio' ? (
        <audio src={src} controls />
      ) : (
        <a href={src} target="_blank" rel="noreferrer" className="text-primary text-sm underline">
          {query.data.filename || 'Download file'}
        </a>
      )}
    </div>
  )
}
