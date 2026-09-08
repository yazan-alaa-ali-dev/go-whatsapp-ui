import { clean, exec, type ApiRequest } from '@/api/request'

export interface SendResult {
  message_id: string
  status: string
}

/**
 * The wire shape of `POST /send/message` — `SendResult` plus one field.
 *
 * **Only this endpoint can deliver by a channel other than WhatsApp, so only this
 * endpoint reports one.** Every other `/send/*` response keeps `SendResult`
 * unchanged, which is why the field goes on a type of its own rather than being
 * added to the shared one as an optional.
 *
 * `channel` is typed `string`, not `'whatsapp' | 'sms'`, and that is deliberate:
 * the server owns that enum. A closed union would make the "a value we do not
 * recognise" branch in `@/lib/send-channel` unreachable to the type checker while
 * leaving it perfectly reachable at runtime, and that branch is the one that stops
 * a future third channel being read as WhatsApp.
 *
 * This type is exported for `@/lib/send-channel` alone. Callers receive
 * `SendMessageResult` below.
 */
export interface SendMessageWire extends SendResult {
  /** `whatsapp` or `sms` today. Absent on an ordinary send. */
  channel?: string
}

/**
 * What a caller of `sendText` receives: the wire shape **with `message_id`
 * withheld**.
 *
 * The reference makes reading `channel` before using `message_id` an obligation
 * on the caller — when the channel is `sms` the id is the carrier's own
 * reference, may be empty, writes no WhatsApp message row, and works with no
 * message endpoint. An obligation on the caller is a rule that gets forgotten, so
 * it is removed from the caller instead: `result.message_id` does not compile,
 * and the id is available only through `usableMessageId` in `@/lib/send-channel`,
 * which answers `null` unless the channel permitted one.
 *
 * `tsc -b` is therefore what enforces the rule, rather than a reviewer noticing.
 */
export type SendMessageResult = Omit<SendMessageWire, 'message_id'>

export interface TextPayload {
  phone: string
  message: string
  reply_message_id?: string
  is_forwarded?: boolean
  duration?: number
}

export function textRequest(payload: TextPayload): ApiRequest {
  return { method: 'POST', path: '/send/message', json: clean(payload) }
}

/**
 * The one send that can answer with a channel. Executed as the wire shape and
 * returned as the narrowed one, so the id leaves this module unreadable — see
 * `SendMessageResult`.
 */
export function sendText(payload: TextPayload): Promise<SendMessageResult> {
  return exec<SendMessageWire>(textRequest(payload))
}

export interface MediaPayload {
  phone: string
  caption?: string
  file?: File
  fileUrl?: string
  reply_message_id?: string
  is_forwarded?: boolean
  duration?: number
}

export type ImagePayload = MediaPayload & { view_once?: boolean; compress?: boolean }

export function imageRequest(p: ImagePayload): ApiRequest {
  return {
    method: 'POST',
    path: '/send/image',
    form: {
      phone: p.phone,
      caption: p.caption,
      image: p.file,
      image_url: p.fileUrl,
      view_once: p.view_once,
      compress: p.compress,
      is_forwarded: p.is_forwarded,
      reply_message_id: p.reply_message_id,
      duration: p.duration,
    },
  }
}

export function sendImage(p: ImagePayload): Promise<SendResult> {
  return exec(imageRequest(p))
}

export function fileRequest(p: MediaPayload): ApiRequest {
  return {
    method: 'POST',
    path: '/send/file',
    form: {
      phone: p.phone,
      caption: p.caption,
      file: p.file,
      file_url: p.fileUrl,
      reply_message_id: p.reply_message_id,
      is_forwarded: p.is_forwarded,
      duration: p.duration,
    },
  }
}

export function sendFile(p: MediaPayload): Promise<SendResult> {
  return exec(fileRequest(p))
}

export type VideoPayload = MediaPayload & {
  view_once?: boolean
  compress?: boolean
  gif_playback?: boolean
}

export function videoRequest(p: VideoPayload): ApiRequest {
  return {
    method: 'POST',
    path: '/send/video',
    form: {
      phone: p.phone,
      caption: p.caption,
      video: p.file,
      video_url: p.fileUrl,
      view_once: p.view_once,
      compress: p.compress,
      gif_playback: p.gif_playback,
      is_forwarded: p.is_forwarded,
      reply_message_id: p.reply_message_id,
      duration: p.duration,
    },
  }
}

export function sendVideo(p: VideoPayload): Promise<SendResult> {
  return exec(videoRequest(p))
}

export function stickerRequest(p: MediaPayload): ApiRequest {
  return {
    method: 'POST',
    path: '/send/sticker',
    form: {
      phone: p.phone,
      sticker: p.file,
      sticker_url: p.fileUrl,
      is_forwarded: p.is_forwarded,
    },
  }
}

export function sendSticker(p: MediaPayload): Promise<SendResult> {
  return exec(stickerRequest(p))
}

export type AudioPayload = MediaPayload & { ptt?: boolean }

export function audioRequest(p: AudioPayload): ApiRequest {
  return {
    method: 'POST',
    path: '/send/audio',
    form: {
      phone: p.phone,
      audio: p.file,
      audio_url: p.fileUrl,
      ptt: p.ptt,
      reply_message_id: p.reply_message_id,
      is_forwarded: p.is_forwarded,
    },
  }
}

export function sendAudio(p: AudioPayload): Promise<SendResult> {
  return exec(audioRequest(p))
}

export interface ContactPayload {
  phone: string
  contact_name: string
  contact_phone: string
}

export function contactRequest(payload: ContactPayload): ApiRequest {
  return { method: 'POST', path: '/send/contact', json: clean(payload) }
}

export function sendContact(payload: ContactPayload): Promise<SendResult> {
  return exec(contactRequest(payload))
}

export interface LinkPayload {
  phone: string
  link: string
  caption?: string
}

export function linkRequest(payload: LinkPayload): ApiRequest {
  return { method: 'POST', path: '/send/link', json: clean(payload) }
}

export function sendLink(payload: LinkPayload): Promise<SendResult> {
  return exec(linkRequest(payload))
}

export interface LocationPayload {
  phone: string
  latitude: string
  longitude: string
}

export function locationRequest(payload: LocationPayload): ApiRequest {
  return { method: 'POST', path: '/send/location', json: clean(payload) }
}

export function sendLocation(payload: LocationPayload): Promise<SendResult> {
  return exec(locationRequest(payload))
}

export interface PollPayload {
  phone: string
  question: string
  options: string[]
  max_answer: number
}

export function pollRequest(payload: PollPayload): ApiRequest {
  return { method: 'POST', path: '/send/poll', json: clean(payload) }
}

export function sendPoll(payload: PollPayload): Promise<SendResult> {
  return exec(pollRequest(payload))
}

export interface PresencePayload {
  type: string
}

export function presenceRequest(payload: PresencePayload): ApiRequest {
  return { method: 'POST', path: '/send/presence', json: clean(payload) }
}

export function sendPresence(payload: PresencePayload): Promise<SendResult> {
  return exec(presenceRequest(payload))
}

export interface ChatPresencePayload {
  phone: string
  action: string
}

export function chatPresenceRequest(payload: ChatPresencePayload): ApiRequest {
  return { method: 'POST', path: '/send/chat-presence', json: clean(payload) }
}

export function sendChatPresence(payload: ChatPresencePayload): Promise<SendResult> {
  return exec(chatPresenceRequest(payload))
}
