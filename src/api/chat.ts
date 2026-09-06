import { http, results } from '@/lib/http'

export interface ChatInfo {
  jid: string
  name: string
  last_message_time: string
  ephemeral_expiration: number
  created_at: string
  updated_at: string
  archived: boolean
}

export interface Pagination {
  limit: number
  offset: number
  total: number
}

export interface ReactionInfo {
  emoji: string
  sender_jid: string
  is_from_me: boolean
  timestamp: string
}

export interface MessageInfo {
  id: string
  chat_jid: string
  sender_jid: string
  content: string
  timestamp: string
  is_from_me: boolean
  media_type: string
  reactions?: ReactionInfo[]
  filename: string
  url: string
  file_length: number

  /**
   * The maskable fields (reference §09). Every one of these is **deleted from
   * the JSON** when the principal lacks its permission — not nulled, not
   * emptied — so they are optional here and the compiler cannot be used to
   * prove one is there.
   *
   * Read them with `hasField` from `@/lib/redaction`, which tests the key
   * rather than the value. `message.sent_by || 'unknown'` and
   * `message.has_debug === false` are both wrong, and both look right.
   */
  metadata_debug?: Record<string, unknown>
  has_debug?: boolean
  transcript?: string
  transcript_language?: string
  transcript_status?: string
  sent_by?: string
  sent_by_name?: string

  /**
   * **Not masked** (§09), and required for that reason: an automated reply can
   * always be told from a human one, even without `messages.origin.read`. Only
   * the human *identity* behind an outgoing message is redacted — `sent_by` and
   * `sent_by_name` above.
   */
  sent_via: string
}

export interface ListChatsParams {
  limit?: number
  offset?: number
  search?: string
  has_media?: boolean
}

export interface ChatMessagesParams {
  limit?: number
  offset?: number
  search?: string
  media_only?: boolean
  is_from_me?: boolean
  start_time?: string
  end_time?: string
}

const enc = encodeURIComponent

export function listChats(params: ListChatsParams) {
  return results<{ data: ChatInfo[]; pagination: Pagination }>(http.get('/chats', { params }))
}

export function getChatMessages(chatJid: string, params: ChatMessagesParams) {
  return results<{ data: MessageInfo[]; pagination: Pagination; chat_info: ChatInfo }>(
    http.get(`/chat/${enc(chatJid)}/messages`, { params }),
  )
}

export function pinChat(chatJid: string, pinned: boolean) {
  return results(http.post(`/chat/${enc(chatJid)}/pin`, { pinned }))
}

export function archiveChat(chatJid: string, archived: boolean) {
  return results(http.post(`/chat/${enc(chatJid)}/archive`, { archived }))
}

export function setDisappearing(chatJid: string, timer_seconds: number) {
  return results(http.post(`/chat/${enc(chatJid)}/disappearing`, { timer_seconds }))
}
