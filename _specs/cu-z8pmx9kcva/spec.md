---
ticket: cu-z8pmx9kcva
stage: spec
mode: standard
status: complete
owner: developer
updated: 2026-08-20
links:
  clickup: "https://app.clickup.com/t/z8pmx9kcva"
  github: ""
---

# Specification — cu-z8pmx9kcva

> 07 · Transcribe voice messages to text via ElevenLabs Scribe v2.

## Business goal

A customer who sends a voice note today reaches a dead end: WhatsApp forbids a
caption on a voice note, so `messages.content` is structurally empty (measured:
480 audio rows, all empty), the omni AI agent has nothing to answer, and the
webhook consumer receives a media path it cannot read. Transcribing the
recording turns a voice note into a question the AI can answer and an operator
can read, without taking anything away from either.

## User story

As **a customer**, I want to send a voice note in my own language and still be
understood and answered by the AI, so that I can ask hands-free while the
operator reviewing the chat can still play my original recording and read what
it said.

## Functional requirements

- **REQ-1** An inbound message carrying audio is transcribed through the
  ElevenLabs Speech-to-Text API before the agent is called.
- **REQ-2** The transcript is stored in a dedicated table, never in
  `messages.content`, and carries a processing status.
- **REQ-3** The transcript reaches the omni agent in the same field a typed
  message uses.
- **REQ-4** The transcript reaches the message webhook consumer in dedicated
  fields, additively.
- **REQ-5** The transcript is readable from the chat messages API next to the
  audio message it belongs to.
- **REQ-6** The language the customer actually spoke is detected, not assumed,
  and travels with the transcript.
- **REQ-7** Every failure mode still delivers the audio and still delivers the
  webhook.

## Non-functional requirements

- **NFR-1** Transcription must not block whatsmeow's event goroutine.
- **NFR-2** The transcription attempt is bounded by a timeout; webhook delivery
  can never wait on it indefinitely.
- **NFR-3** Concurrent transcriptions are bounded, so a burst of voice notes
  cannot grow the process or the provider bill without limit.
- **NFR-4** No secret, no audio payload and no transcript text is ever written to
  a log line.
- **NFR-5** With the integration unconfigured the service behaves exactly as it
  does today — no request, no new field, no new log line.

## Constraints

- **C-1** `WHATSAPP_AUTO_DOWNLOAD_MEDIA` must be enabled. With it off the audio
  bytes are never fetched and transcription is unavailable by construction.
- **C-2** `language_code` is omitted from the provider request by default so
  Scribe v2 auto-detects. Hard-coding `language_code=ar` is not acceptable.
- **C-3** The change is additive to the webhook payload. No field it sends today
  changes shape or value.
- **C-4** `GET /message/{id}/download` is not modified in any way.
- **C-5** Rows are keyed by `(device_id, message_id)`, like every other
  message-scoped table.
- **C-6** Transcription refuses exactly the chats the agent bridge refuses. A
  group voice note is billed but can never produce the AI answer the business
  goal names, so the two paths share one definition of "an inbound customer
  message".

## Acceptance criteria

| ID | Criterion |
|----|-----------|
| **AC-1** | A migration creates `message_transcript` with `device_id`, `message_id`, `text`, `engine`, `language`, `status`, `duration_ms`, `created_at`, keyed by `(device_id, message_id)`. |
| **AC-2** | An inbound **direct** message whose media type is audio is transcribed through the ElevenLabs Speech-to-Text API with `model_id=scribe_v2` **before** the omni agent is called. "Inbound direct" is the set the agent bridge already accepts: not from this device, not a group, not broadcast/status, not a protocol message, not another device paired on this server. |
| **AC-3** | The resulting text is sent to the omni agent in the same `text` field a typed message would use. |
| **AC-4** | The transcript is persisted and exposed as `transcript` on `MessageInfo`, always, with no query parameter. |
| **AC-5** | `status` records at least `pending`, `done`, `failed` and `no_speech`. |
| **AC-6** | The **detected** language is persisted in `message_transcript.language` as a language code (`ar`, `en`) and returned next to the transcript on `MessageInfo` and in the webhook. |
| **AC-7** | The message webhook payload for an audio message carries `transcript`, `transcript_language` and `transcript_status` alongside the existing `audio` field. |
| **AC-8** | Every field the message webhook sends today is left untouched: `body` keeps its current value, `audio` keeps its path/url shape, and nothing existing is substituted. |
| **AC-9** | The webhook for an audio message is dispatched **after** the transcription attempt has resolved, so `transcript_status` is always final — `done`, `failed` or `no_speech`, never `pending`. |
| **AC-10** | No language is forced: `language_code` is omitted unless `ELEVENLABS_STT_LANGUAGE` is explicitly set. The setting exists and is empty by default. |
| **AC-11** | An Arabic voice note (dialect or MSA) returns Arabic script with `language = ar`; an English voice note returns English with `language = en`. Neither is transliterated or translated into the other. |
| **AC-12** | A transcription failure sets `status=failed`, still delivers the audio, does not abort the agent flow, and still dispatches the webhook with `transcript_status=failed` and no transcript text. |
| **AC-13** | An empty transcription result sets `status=no_speech`, sends no text to the agent, and still dispatches the webhook with `transcript_status=no_speech`. |
| **AC-14** | Invalid ElevenLabs credentials (provider 401/403) are logged with the message id and an authorization reason class, the audio message stays stored and playable, the webhook is still delivered with `transcript_status=failed`, and no malformed request reaches the omni agent. |
| **AC-15** | The transcription attempt is bounded by a timeout; on expiry the webhook is dispatched with `transcript_status=failed`. |
| **AC-16** | The agent timeout is raised to absorb transcription latency. |
| **AC-17** | The audio message keeps `media_type=audio`, its filename and its download route unchanged; `GET /message/{id}/download` is untouched. |
| **AC-18** | Each transcription logs the message id, the engine, the audio duration and the outcome; the audio duration is recorded so spend can be reviewed. No log line carries the API key, the audio, or the transcript text. |
| **AC-19** | With `ELEVENLABS_API_KEY` empty the feature is entirely inert: no provider request, no new webhook field, no new `MessageInfo` field, no behavioural change anywhere. |

## Out of scope

- Backfilling the 480 historical audio messages (explicit in the ticket).
- The dashboard rendering of the player + transcript bubble (ticket 11).
- Transcribing outbound audio, video notes, group/broadcast audio, or any media
  type other than audio (C-6).
- A retention sweep for `message_transcript`. A transcript's lifetime is its
  message's lifetime: it is deleted with the message and with the chat, the same
  way `messages.content` is. Diagnostics rows needed their own sweep (ticket 10)
  because nothing else deleted them; that does not apply here.
- Re-transcribing on demand, or any REST endpoint for transcription.
- Any change to `GET /message/{id}/download` or to media storage on disk.
