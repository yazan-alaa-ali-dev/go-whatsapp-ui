---
ticket: cu-z8pmx9kcva
stage: plan
mode: standard
status: complete
owner: developer
updated: 2026-08-20
links:
  clickup: "https://app.clickup.com/t/z8pmx9kcva"
  github: ""
---

# Plan — cu-z8pmx9kcva

> 07 · Transcribe voice messages to text via ElevenLabs Scribe v2.
> Branch `ticket/cu-z8pmx9kcva`, cut from `ticket/cu-z8pmx9kcvd` (ticket 10,
> PR #7) — the current tip of the chain. Ticket 07 depends on 03 (the message
> debug storage layer, whose `(device_id, message_id)` table pattern this ticket
> copies) and on 06 (the omni agent bridge, which this ticket feeds transcribed
> text into). Neither is on `main`. The PR therefore targets
> `ticket/cu-z8pmx9kcvd`, not `main`.

## Panel response (Revision 1, 2026-08-20)

The advisory panel (`senior-reviewer`, `security-reviewer`,
`performance-reviewer`) reviewed the first draft of this plan before any code was
written. Adopted findings are marked `[P-n]` where they appear below; the
declined ones are argued at the end of this section. Everything after this
section is the rewritten plan, not the reviewed draft.

**Adopted — majors**

- `[P-1]` **all three lenses, independently:** the draft spawned the goroutine
  *before* admission and then blocked for a slot on a deadline-less
  `context.Background()`. That is precisely the failure mode ticket 06 documents
  at `agent_bridge.go:204-208` ("admission must not be [detached], or the bound
  would cap HTTP calls while goroutines still grew without limit"), and it is
  worse here: `ctx.Done()` never fires while waiting, so under saturation the
  webhook for that message would **never** be dispatched — silently breaking
  AC-9, AC-12 and REQ-7 rather than degrading. Adopted in full: admission happens
  **synchronously in `handleMessage`**, non-blocking, and refuses rather than
  queues (`agentGate.acquire`'s existing semantics). A refused message still
  takes the audio path — it resolves immediately to `failed` without a provider
  call, so the webhook still carries a final status.
- `[P-2]` **security + performance:** transcription is billed *before* the agent
  gate, so `agentRepliesPerChatPerMinute = 10` (`agent_bridge.go:41`) no longer
  caps spend — a concurrency limit is not a rate limit, and one chat could drive
  unlimited sequential paid calls. Adopted: transcription gets its own
  `agentGate` instance (per-chat in-flight + per-chat/minute + process-wide),
  reusing the type rather than re-deriving the bound.
- `[P-3]` **security:** the provider's response text is untrusted third-party
  input that the draft only truncated, then wrote to SQLite, the webhook JSON,
  `MessageInfo` and the agent prompt — with none of the discipline
  `sanitizeAgentReply` (`agent_bridge.go:442-465`) applies to the *other* model
  output crossing the same boundary. Adopted: `sanitizeTranscript` checks
  `utf8.ValidString`, strips C0/DEL (keeping `\n` and `\t`), trims, then
  truncates on a rune boundary. The language code is separately charset-bounded
  before it reaches a `VARCHAR(32)` column and the webhook.
- `[P-4]` **senior:** three existing test files would have failed to compile —
  `event_message_test.go` has 12 `buildEventPayload(...)` call sites and
  `event_message_handler_test.go:108,115` calls `handleWebhookForward(ctx, evt, client)`.
  Adopted, and better than the suggested fix: the new parameter is added on
  **new `...WithTranscription` functions**, and every existing signature becomes
  a one-line wrapper delegating with `nil`. Zero test churn, and the parameter
  stays compiler-enforced rather than hidden in a context value.
- `[P-5]` **senior:** `TestMessageDebugSchemaIsAppendedNotEdited`
  (`sqlite_repository_debug_test.go:576`) hard-asserts `len(migrations) != 48`;
  appending two migrations turns it into a **new** failure, which this plan's own
  bar forbids. Adopted: the file is now in "Files to change", the count becomes
  50, and the slice is pinned to `migrations[43:48]` so what the test exists to
  guard — that 44-48 were never edited — still holds.

**Adopted — minors**

- `[P-6]` **security + performance:** the 16 MiB cap rejected *after* the
  download had already materialised the bytes (`pkg/utils/whatsapp.go:848-857`
  checks against `WhatsappSettingMaxDownloadSize = 500 MB`). Adopted:
  `audioMsg.GetFileLength()` is checked against `sttMaxAudioBytes` **before**
  the download, and the byte slice is released before the agent/webhook stage.
- `[P-7]` **security:** `ELEVENLABS_API_BASE_URL` was concatenated with no
  scheme check — an `http://` or mistyped base would ship the `xi-api-key` and
  the customer's voice in clear text. Adopted, and enforced at the point of use
  rather than only at startup: `Transcribe` refuses a non-`https` endpoint
  outright, with a loopback carve-out so `httptest` still works. Startup also
  logs the (redacted) base URL and flags a bad one, mirroring
  `logAgentEndpointURL` (`cmd/root.go:455-468`).
- `[P-8]` **security:** the multipart part headers were built from
  sender-controlled values — `MimeType` from `media.GetMimetype()` and a filename
  from the message — and Go's `escapeQuotes` escapes only `"` and `\`, not
  CR/LF. Adopted: the filename is derived from the message id through a
  `[A-Za-z0-9._-]` filter plus an extension chosen from an allowlist, and the
  content type is allowlisted against known audio types (defaulting to
  `audio/ogg`).
- `[P-9]` **security + performance:** copying `message_debug`'s
  `WHERE message_id = ?` (`sqlite_repository.go:715`) would both delete another
  device's transcript for a colliding id **and** full-scan, since neither the PK
  nor the chat index leads with `message_id`. Adopted, and one change fixes
  both: `DeleteMessage` scopes on `(chat_jid, message_id)` — exactly what the
  `messages` delete beside it at `:718` uses, and served by the new chat index —
  and `DeleteMessageByDevice` scopes on the primary key.
- `[P-10]` **security:** a panic in the new STT/parse path would kill the
  process, where today the webhook dispatch at `event_message_handler.go:63` is
  unconditional. Adopted: the transcription stage recovers into a `failed`
  result, the agent call is separately recovered, and `handleWebhookForward` is
  therefore reached on every path.
- `[P-11]` **performance + senior:** the draft never pinned the storage location
  for the single download. `buildMediaFields` writes to `config.PathMedia`
  (`event_message.go:267`) while `handleImageMessage` uses `config.PathStorages`
  (`event_message_handler.go:91`); the wrong one would silently change the
  `audio` path the webhook emits. Adopted: `config.PathMedia`, stated explicitly.
- `[P-12]` **performance:** on a failed download the draft fell through to
  today's code, which would issue a *second* `ExtractMedia` against the same
  already-failed CDN object — doubling the failure latency the now-blocking
  webhook inherits. Adopted: `inboundTranscription.DownloadAttempted` records
  that the download was tried, and `buildMediaFields` skips the retry. The
  emitted payload is unchanged either way (no `audio` key), so AC-8 holds.
- `[P-13]` **senior:** `Result.LanguageProb` and `Result.LanguageRaw` had no
  consumer — neither column nor log line. Adopted: both dropped.
- `[P-14]` **senior:** the ISO-639-3 → 639-1 "compact table covering the common
  set" was speculative; AC-6 names only `ar` and `en` and the pass-through
  fallback already keeps anything else diagnosable. Adopted: `ara → ar`,
  `eng → en`, everything else passes through sanitised.
- `[P-15]` **senior:** `duration_ms` semantics were never fixed. Adopted:
  `duration_ms` is the **audio** duration (the cost driver AC-18 names) —
  engine-reported when present, `GetSeconds() * 1000` otherwise. Wall-clock
  latency is log-only and never enters the column.
- `[P-16]` **senior:** raising `AgentTimeout` is inert for the voice path —
  `runAgentBridge` builds its own budget at `agent_bridge.go:273` from a
  deadline-free context, so transcription latency never eats the agent's. AC-16
  mandates the raise, so it is made; the plan and `verify.md` state plainly that
  it is a documentation-level change with no measurable effect on this flow,
  rather than claiming a benefit that does not exist.
- `[P-17]` **senior + performance:** delaying the webhook also delays **Chatwoot**
  — `forwardPayloadToConfiguredWebhooks` fans out to both
  (`webhook_forward.go:139-141`). Adopted as an explicitly accepted trade,
  recorded here and in the readme, and mitigated by `[P-18]`.
- `[P-18]` **performance:** 60s was too long a wait for a consumer to inherit.
  Adopted: `ELEVENLABS_STT_TIMEOUT` defaults to **30s**, and it now bounds the
  **whole stage** (slot handling, download and provider call), not just the HTTP
  request — so 30s is the true worst case a webhook consumer can wait.
- `[P-19]` **senior:** extracting `detachedEventContext` is a fourth change to
  `agent_bridge.go`. Adopted: listed in step 7.
- `[P-20]` **senior:** line citations had drifted (`event_message.go:257` is
  `:267`; the detached-context pattern is `agent_bridge.go:244-247`; the
  migration-47 index is `:2956`). Adopted: refreshed throughout.
- `[P-21]` **performance + security:** group audio would be transcribed and
  billed although `agentSkipReason` drops groups (`agent_bridge.go:476`) — spend
  that can never produce the AI answer the business goal names. Adopted, without
  adding a config toggle: the chat-shape guards are extracted from
  `agentSkipReason` into a shared `directInboundSkipReason`, and transcription
  refuses exactly the set the agent bridge refuses. AC-2's "an inbound message
  whose media type is audio" is read as the user story reads it — an inbound
  direct message from a customer.
- `[P-22]` **security:** keep the explicit "device_id is required" rejection in
  the batch reader rather than leaning on the wrapper's fallback. Adopted.

**Declined, with reasons**

- **Streaming the multipart body through `io.Pipe` instead of buffering**
  (performance, minor). Declined. A piped body is sent with chunked
  transfer-encoding and no `Content-Length`, and this is a third-party API whose
  acceptance of that cannot be verified from here — trading a known-good upload
  for an unverifiable one to save memory that is already bounded is the wrong
  direction. The bound is explicit instead: `sttMaxAudioBytes` 16 MiB ×
  `sttMaxInFlight` 8, doubled by the multipart copy, is a ~256 MiB worst case,
  and a real WhatsApp voice note is under 1 MiB, so the practical ceiling is
  ~16 MiB. Recorded here so it is a measured decision, not an oversight.
- **Writing `pending` only "when it buys crash visibility"** (performance,
  minor). Declined: AC-5 requires `pending` to be a recorded status, and it *is*
  the crash-visibility record — a process that dies mid-transcription leaves a
  diagnosable row rather than none. One extra small write per voice note, on a
  path already bounded to 8 concurrent, is not the constraint.
- **A retention sweep for `message_transcript`** (security, minor). Declined,
  with the position recorded rather than left to inference. A transcript is not
  diagnostics: it is display data the operator is meant to read *next to* a
  message that is itself unbounded. Deleting the transcript while the audio
  remains playable would make the record incoherent, and would delete the only
  readable form of what the customer said. Its lifetime is deliberately its
  message's lifetime — it is removed by every message, chat and device delete
  path (six sites). The distinct DPA fact, that voice audio is sent to a
  third-party processor, is documented in the readme so it is a visible, decided
  exposure. If a retention window is wanted it belongs in its own ticket, next to
  a decision about the audio files themselves.
- **Trimming `agentMaxInFlight` to offset the `AgentTimeout` raise** (both
  lenses, minor). Declined as out of scope: re-tuning ticket 06's concurrency
  ceiling is not something AC-16 asks for, and doing it inside this ticket would
  change the behaviour of every text message for reasons unrelated to
  transcription. The new worst case (32 × 120s, plus 30s STT and 30s delivery
  per voice note) is stated in `verify.md` instead.
- **Dropping the `ELEVENLABS_API_BASE_URL` env/flag surface in favour of a
  test-only var** (senior, minor). Partially adopted: the "test seam"
  justification is withdrawn — the tests use it incidentally, not as their
  rationale. The setting itself is kept on the residency argument alone, which
  the same lens accepted as standing on its own: ElevenLabs publishes regional
  endpoints, and where a customer's voice is processed is a deployment decision.

## Approach

Transcription is a **new stage inserted between message storage and the two
existing outbound paths** (the agent bridge and the webhook forward), and only
for inbound direct audio. Everything else in `handleMessage` is untouched.

Four properties drive the design:

1. **Ordering.** AC-9 requires the webhook to carry a *final* status, so the
   webhook forward for an audio message must run **after** the transcription
   attempt resolves. Today `handleWebhookForward` is called last in
   `handleMessage` (`event_message_handler.go:63`) and detaches internally.
2. **Non-blocking.** `handleMessage` runs on whatsmeow's event goroutine
   (dispatched synchronously at `event_handler.go:55` — the same fact ticket 06
   documented). A network round trip there would stall inbound message
   processing for the whole device.
3. **Admission before detachment** `[P-1]`. The gate is taken on the event
   goroutine and refuses rather than queues, so neither goroutines nor provider
   spend can grow with the inbound rate.
4. **One download** `[P-11]`, `[P-12]`. `buildMediaFields` already downloads the
   audio (`event_message.go:267`). Since the webhook now *waits* behind
   transcription, downloading twice would double both the CDN traffic and the
   latency the consumer sees.

## Steps

### 1. Configuration (`config/settings.go`, `cmd/root.go`)

| Setting | Env | Default | Why |
|---------|-----|---------|-----|
| `ElevenLabsAPIKey` | `ELEVENLABS_API_KEY` | empty | The single switch. Empty means inert (AC-19), exactly as `AgentWebhookURL` gates the bridge. |
| `ElevenLabsAPIBaseURL` | `ELEVENLABS_API_BASE_URL` | `https://api.elevenlabs.io` | ElevenLabs publishes regional residency endpoints. Where a customer's voice is processed is a deployment decision, not a compile-time one `[P-7]`. |
| `ElevenLabsSTTLanguage` | `ELEVENLABS_STT_LANGUAGE` | empty | **Required by AC-10.** Empty means `language_code` is omitted, so the engine auto-detects. |
| `ElevenLabsSTTTimeout` | `ELEVENLABS_STT_TIMEOUT` | **`30s`** | **Required by AC-15**, and `[P-18]`: it bounds the *whole stage*, so it is exactly the worst case a webhook consumer can wait. |

`AgentTimeout` default is raised from 90s to 120s (AC-16). Per `[P-16]` this is
recorded for what it is: a documentation-level change. `runAgentBridge` derives
its budget from a deadline-free detached context (`agent_bridge.go:273`), so
transcription latency never consumed the agent's budget in the first place.

The model id is a **constant**, `sttModelScribeV2 = "scribe_v2"`, not a setting:
AC-2 pins it, and a setting for a value the spec fixes is over-engineering.

Startup logging: `logSpeechToTextConfiguration()` beside `logAgentConfiguration`
(`cmd/root.go:403`) — enabled/disabled, the **redacted** base URL, the model,
pinned language or auto-detect, and the timeout. Never the key. Debug level when
the key is empty, like the agent block.

### 2. Provider client — new package `infrastructure/elevenlabs`

`stt.go`, one exported call:

    type Request struct{ Audio []byte; Mimetype, MessageID string }
    type Result struct {
        Text             string
        LanguageCode     string  // sanitised; "ara" -> "ar", "eng" -> "en"
        AudioDurationSec float64
    }
    func Transcribe(ctx context.Context, req Request) (*Result, error)

- `POST {base}/v1/speech-to-text`, `multipart/form-data`, header `xi-api-key`.
- Fields: `model_id=scribe_v2`; `file`; and `language_code` **only when**
  `config.ElevenLabsSTTLanguage` is non-empty (AC-10, C-2).
- `[P-7]` The endpoint must be `https`, or `Transcribe` refuses before building
  the request. Loopback hosts are carved out so `httptest` works.
- `[P-8]` The multipart filename is `voice-<sanitised message id>.<ext>` and the
  part's content type comes from an audio allowlist — neither is taken raw from
  the sender.
- Dedicated `http.Client` with `CheckRedirect: http.ErrUseLastResponse` and
  explicit transport/dial/TLS budgets — the shape `agentHTTPClient` uses
  (`agent_bridge.go:82`), for the same reason: a redirect must not replay the API
  key or the customer's voice to another host.
- Response read through an `io.LimitReader` and the body drained before close.
- `401`/`403` map to the sentinel `ErrUnauthorized` so the caller can log an
  authorization reason class (AC-14) without echoing the body.
- `[P-14]` Language normalisation is `ara -> ar`, `eng -> en`, everything else
  passed through sanitised (lowercased, `[a-z0-9-]`, capped) `[P-3]`.
- Nothing in this package logs. It returns errors; the caller decides what is
  safe to write.

### 3. One download instead of two (`pkg/utils/whatsapp.go`)

`ExtractMedia` (`:842`) downloads, writes the file, and discards the bytes.
Split it:

    func ExtractMediaWithData(ctx, client, storageLocation, mediaFile) (ExtractedMedia, []byte, error)
    func ExtractMedia(ctx, client, storageLocation, mediaFile) (ExtractedMedia, error) // delegates, drops the bytes

Pure refactor: the body moves, the behaviour does not. Every existing caller
keeps calling `ExtractMedia`.

### 4. Storage (`domains/chatstorage`, `infrastructure/chatstorage`)

**Migration 49** — `message_transcript`. *Not* 47: the ticket text says
"Migration 47", but 47 and 48 were taken by ticket 10 (`sqlite_repository.go:2956`,
`:2972`), implemented before this one. The number is positional in
`getMigrations()`; the requirement is that a migration creates the table.

    CREATE TABLE IF NOT EXISTS message_transcript (
        device_id   VARCHAR(255) NOT NULL DEFAULT '',
        message_id  VARCHAR(255) NOT NULL,
        chat_jid    VARCHAR(255) NOT NULL DEFAULT '',
        text        TEXT NOT NULL DEFAULT '',
        engine      VARCHAR(64) NOT NULL DEFAULT '',
        language    VARCHAR(32) NOT NULL DEFAULT '',
        status      VARCHAR(32) NOT NULL DEFAULT '',
        duration_ms INTEGER NOT NULL DEFAULT 0,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (device_id, message_id)
    )

Two columns beyond the AC list, both additive and both load-bearing: `chat_jid`
so the chat-keyed cleanup paths can delete transcripts the way they already
delete `message_debug` (`sqlite_repository.go:257,293`), and `updated_at` because
the row is written twice (`pending`, then final). `[P-15]` `duration_ms` is the
**audio** duration, never latency.

**Migration 50** — `CREATE INDEX idx_message_transcript_chat ON message_transcript(chat_jid, message_id)`.
It serves both the chat-keyed deletes and, per `[P-9]`, the now-chat-scoped
`DeleteMessage`.

Domain (`domains/chatstorage/chatstorage.go`): a `MessageTranscript` struct plus
the four status constants (`TranscriptStatusPending|Done|Failed|NoSpeech`) so no
caller spells a status as a literal.

Interface (`domains/chatstorage/interfaces.go`):

    SetMessageTranscript(ctx context.Context, transcript *MessageTranscript) error
    GetMessageTranscriptBatch(ctx context.Context, deviceID string, messageIDs []string) (map[string]*MessageTranscript, error)

The implementation mirrors `SetMessageDebug` / `GetMessageDebugBatch`
(`sqlite_repository.go:2339`, `:2419`) deliberately: same validation shape
(required ids; the chat JID parsed and checked for *both* parts; normalised with
`NormalizeJIDFromLID` so it agrees byte-for-byte with `messages.chat_jid`), same
`ON CONFLICT(device_id, message_id) DO UPDATE`, same chunked `IN (...)` read,
`[P-22]` same explicit empty-device rejection, and the same "log a reason class,
never the payload" discipline. Additionally the status is validated against the
four constants, and `[P-3]` the text is sanitised and bounded by
`maxTranscriptBytes` (32 KiB) — **truncated on a rune boundary and still stored**
rather than rejected: a transcript is display data, and half a long one beats
none. That is the opposite of the diagnostics payload's trade-off, deliberately.

Cleanup — the six `message_debug` sites, with `[P-9]`'s scoping correction:

| Site | Transcript delete |
|------|-------------------|
| `DeleteChat` `:257` | `WHERE chat_jid = ?` |
| `DeleteChatByDevice` `:293` | `WHERE chat_jid = ? AND device_id = ?` |
| `DeleteMessage` `:715` | `WHERE message_id = ? AND chat_jid = ?` — matches the `messages` delete beside it at `:718`, and is index-served |
| `DeleteMessageByDevice` `:731` | `WHERE device_id = ? AND message_id = ?` — the primary key |
| truncate-all `:1301` | `DELETE FROM message_transcript` |
| `DeleteDeviceData` `:1349` | `WHERE device_id = ?` |

Wrapper (`chatstorage_wrapper.go`): both methods delegate with the same
`deviceID == "" -> r.deviceID` fallback the debug methods use (`:242`, `:250`).

### 5. Transcription stage — new file `infrastructure/whatsapp/transcription.go`

    type inboundTranscription struct {
        Media             *utils.ExtractedMedia // the single download, handed to the webhook builder
        DownloadAttempted bool                  // [P-12] so the webhook does not retry a failed download
        Text              string
        Language          string
        Status            string
        Engine            string
        DurationMS        int64
    }

Order of work inside the detached goroutine:

1. The stage runs under `context.WithTimeout(detached, config.ElevenLabsSTTTimeout)`
   `[P-18]`, so download + provider call together cannot exceed it. The two
   database writes use their own short budget derived from `detached`, so they
   still land after the stage deadline expires.
2. `[P-1]` A message refused by the gate (admission already happened in
   `handleMessage`) resolves immediately to `failed` with no provider call.
3. Write the `pending` row (AC-5).
4. `[P-6]` `audioMsg.GetFileLength()` is checked against `sttMaxAudioBytes`
   before anything is downloaded; over the cap resolves to `failed`.
5. `[P-11]` `utils.ExtractMediaWithData(stageCtx, client, config.PathMedia, audioMsg)`
   — the one download. `DownloadAttempted` is set either way. On failure:
   `failed`, `Media` nil, and the webhook then behaves exactly as it does today
   when a download fails (the `audio` key is simply absent — `event_message.go:262`).
6. `elevenlabs.Transcribe` under the stage context.
7. Outcome: error means `failed`; empty text after sanitisation means
   `no_speech`; otherwise `done` (AC-12, AC-13).
8. Write the final row, release the audio bytes, then **one** log line: message
   id, device id, engine, status, audio duration (the cost driver), wall-clock
   latency, language. Never the text, never the key, never the audio (AC-18,
   NFR-4).
9. `[P-10]` The whole function recovers into a `failed` result, so a panic
   degrades the transcript instead of killing the process.

`transcriptionApplies(evt)` gates entry: an audio message, `[P-21]`
`directInboundSkipReason(evt) == ""` (the chat-shape guards shared with the agent
bridge — not from me, not a group, not broadcast/status, not a protocol message,
not another local device), `config.WhatsappAutoDownloadMedia` on (C-1), and
`ElevenLabsAPIKey` non-empty (AC-19).

### 6. Wiring (`event_message_handler.go`)

    handleAutoReply(ctx, evt, chatStorageRepo, client)

    if transcriptionApplies(evt) {
        // [P-1] Admission on the event goroutine, refusing rather than queueing.
        release, refused := transcriptionCalls.acquire(evt.Info.Chat.String(), time.Now())
        detached := detachedEventContext(ctx)
        go func() {
            if release != nil {
                defer release()
            }
            result := transcribeInboundAudio(detached, evt, chatStorageRepo, client, refused)
            withRecover("agent bridge", func() {
                handleAgentBridgeWithText(detached, evt, chatStorageRepo, client, result.Text)
            })
            handleWebhookForward(detached, evt, client, result)   // [P-10] always reached
        }()
        return
    }

    handleAgentBridge(ctx, evt, chatStorageRepo, client)
    handleWebhookForward(ctx, evt, client, nil)

One goroutine, not three: the ordering AC-9 requires *is* the sequence inside it.
`handleAgentBridgeWithText` still detaches its own call, so the webhook waits for
the transcription only — never for the model.

`[P-17]` Accepted consequence: `forwardPayloadToConfiguredWebhooks` fans out to
Chatwoot as well (`webhook_forward.go:139-141`), so a voice note now reaches a
Chatwoot inbox up to `ELEVENLABS_STT_TIMEOUT` later than it does today, and after
a text message sent behind it in the same chat. `[P-18]`'s 30s default is the
bound on that, and the readme says so.

### 7. Agent bridge (`agent_bridge.go`)

Four surgical changes, no behaviour change on the existing path:

- `handleAgentBridge` becomes a one-line wrapper over
  `handleAgentBridgeWithText(..., extractGenuineText(evt))`.
- `[P-21]` The chat-shape guards move out of `agentSkipReason` into
  `directInboundSkipReason(evt)`, shared with transcription.
  `agentSkipReason(evt)` keeps its signature and behaviour exactly, so every
  ticket-06 test written against it survives untouched.
- `runAgentBridge` takes `text` as a parameter instead of recomputing it.
- `[P-19]` `detachedEventContext(ctx)` is extracted from `handleAgentBridge`
  (`:244-247`) and reused by the transcription path.

`agentRequest.Type` stays `"chat"` for a transcribed voice note. AC-3 says the
text goes in the field a typed message would use; inventing a new `type` value
would be a contract change with the omni side that no AC asks for.

### 8. Webhook payload (`event_message.go`, `event_message_handler.go`)

`[P-4]` The result is threaded explicitly, but on **new** entry points, so no
existing call site changes:

    handleWebhookForward(ctx, evt, client)                        -> delegates with nil
    handleWebhookForwardWithTranscription(ctx, evt, client, tr)
    createWebhookEvent / buildEventPayload                        -> delegate with nil
    ...WithTranscription variants carry it down to buildMediaFields

Inside `buildMediaFields`, the audio branch:

- reuse `transcription.Media` when present instead of downloading again — the
  `audio` field keeps the identical shape it has today (AC-8);
- `[P-12]` skip the download entirely when `DownloadAttempted` and `Media == nil`;
- otherwise the branch is exactly today's code;
- then `transcript_status`, and when non-empty `transcript` and
  `transcript_language`, are added (AC-7). Nothing is removed or substituted, and
  a `failed`/`no_speech` outcome adds no `transcript` key at all (AC-12, AC-13).

With the feature off, `transcription` is always `nil` and the payload is
byte-identical to today's (AC-19).

### 9. Chat messages API (`domains/chat/chat.go`, `usecase/chat.go`)

`MessageInfo` gains `Transcript`, `TranscriptLanguage`, `TranscriptStatus`, all
`omitempty` — always returned, no query parameter (AC-4), and absent from
messages that have no transcript, so the 480 historical audio rows and every text
message keep their current payload.

`GetChatMessages` (`usecase/chat.go:219`) collects the ids of the page's
`media_type == "audio"` messages and issues **one** `GetMessageTranscriptBatch`
per page — never per message. The page is capped at 100
(`validations/chat_validation.go:37`) and `deviceID` is already guaranteed
non-empty (`usecase/chat.go:125-128`). A lookup error is logged and the messages
are returned without transcripts: a display field must never fail a history read.

### 10. Documentation (`readme.md`)

One section: what is transcribed, the four statuses, the new webhook fields, the
env vars (placeholder values only), the `WHATSAPP_AUTO_DOWNLOAD_MEDIA`
prerequisite, `[P-17]` the Chatwoot/webhook latency trade, and the plain
statement that voice audio leaves the box for a third-party processor.
`src/.env.example` stays excluded, as in tickets 05, 06, 08 and 10 — it carries
no `AGENT_*` key either, and adding one family but not the other would
misrepresent what a fresh deployment needs.

## Files to change

| File | Change |
|------|--------|
| `src/infrastructure/elevenlabs/stt.go` | **new** — the provider client |
| `src/infrastructure/elevenlabs/stt_test.go` | **new** — httptest-backed contract tests |
| `src/infrastructure/whatsapp/transcription.go` | **new** — the transcription stage |
| `src/infrastructure/whatsapp/transcription_test.go` | **new** — outcome, ordering and payload tests |
| `src/infrastructure/chatstorage/sqlite_repository_transcript_test.go` | **new** — storage tests |
| `src/config/settings.go` | new `ElevenLabs*` settings; `AgentTimeout` 90s to 120s |
| `src/cmd/root.go` | env binding, flags, `logSpeechToTextConfiguration` |
| `src/pkg/utils/whatsapp.go` | `ExtractMediaWithData` split out of `ExtractMedia` |
| `src/domains/chatstorage/chatstorage.go` | `MessageTranscript` + status constants |
| `src/domains/chatstorage/interfaces.go` | two repository methods |
| `src/infrastructure/chatstorage/sqlite_repository.go` | migrations 49-50, both methods, six cleanup sites |
| `src/infrastructure/chatstorage/sqlite_repository_debug_test.go` | `[P-5]` migration count 48 to 50; slice pinned to `[43:48]` |
| `src/infrastructure/whatsapp/chatstorage_wrapper.go` | delegate both methods |
| `src/infrastructure/whatsapp/event_message_handler.go` | the audio branch in `handleMessage`; `handleWebhookForwardWithTranscription` |
| `src/infrastructure/whatsapp/event_message.go` | `...WithTranscription` payload builders; transcript fields |
| `src/infrastructure/whatsapp/agent_bridge.go` | `handleAgentBridgeWithText`, `directInboundSkipReason`, `runAgentBridge` text parameter, `detachedEventContext` |
| `src/domains/chat/chat.go` | three `MessageInfo` fields |
| `src/usecase/chat.go` | batch transcript hydration |
| `src/usecase/chat_test.go` | stub gains the new methods + a hydration test |
| `readme.md` | documentation section |

No deployment runtime file is touched: not `docker-compose.yml`, not
`docker/golang.Dockerfile`, not `docker/entrypoint.sh`, not any workflow under
`.github/`.

## Validation strategy

| Check | Command |
|-------|---------|
| build | `go build -C src ./...` |
| vet | `go vet -C src ./...` |
| new tests | `go test -C src -run "Transcri\|ElevenLabs\|Stt\|STT" ./...` |
| regression baseline | `go test -C src ./...`, compared package-by-package against `ticket/cu-z8pmx9kcvd` |

The parent branch carries a known set of pre-existing failures (67, measured at
tickets 06, 08 and 10). The bar is **no new failure**, measured by running the
same command on the parent branch.

## Rollback

Unset `ELEVENLABS_API_KEY` and restart: `transcriptionApplies` returns false for
every message, the audio branch of `handleMessage` is never taken, and the
service behaves exactly as it does today. The `message_transcript` table is left
in place and inert — `CREATE TABLE IF NOT EXISTS` makes re-running the migration
a no-op. Full rollback is `git revert` of the single commit; no migration is
destructive and no existing column is altered.

## Out of scope

As `spec.md > Out of scope`. In particular: no backfill of the 480 historical
audio messages, no dashboard rendering (ticket 11), no transcription of video
notes or outbound audio, no retention sweep for `message_transcript` (argued
under "Declined" above), and no change to `GET /message/{id}/download`.
