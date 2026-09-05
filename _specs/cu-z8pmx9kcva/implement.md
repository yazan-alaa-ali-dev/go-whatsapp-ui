---
ticket: cu-z8pmx9kcva
stage: implement
mode: standard
status: complete
owner: developer
updated: 2026-08-20
links:
  clickup: "https://app.clickup.com/t/z8pmx9kcva"
  github: ""
---

# Implementation — cu-z8pmx9kcva

07 · Transcribe voice messages to text via ElevenLabs Scribe v2.
Branch `ticket/cu-z8pmx9kcva`, cut from `ticket/cu-z8pmx9kcvd` (ticket 10, PR #7)
because ticket 03's storage pattern and ticket 06's agent bridge are both hard
dependencies and neither is on `main` yet. The PR targets that branch, not `main`.

## Files changed

| File | Change |
|------|--------|
| `src/infrastructure/elevenlabs/stt.go` | **new** — the provider client (~330 lines) |
| `src/infrastructure/elevenlabs/stt_test.go` | **new** — 11 contract tests |
| `src/infrastructure/whatsapp/transcription.go` | **new** — the transcription stage (~300 lines) |
| `src/infrastructure/whatsapp/transcription_test.go` | **new** — 15 tests (outcomes, payload, ordering) |
| `src/infrastructure/chatstorage/sqlite_repository_transcript_test.go` | **new** — 11 storage tests |
| `src/config/settings.go` | four `ElevenLabs*` settings; `AgentTimeout` 90s → 120s |
| `src/cmd/root.go` | env binding, four flags, `logSpeechToTextConfiguration` |
| `src/pkg/utils/whatsapp.go` | `ExtractMediaWithData` split out of `ExtractMedia` |
| `src/domains/chatstorage/chatstorage.go` | `MessageTranscript`, four status constants, `IsValidTranscriptStatus` |
| `src/domains/chatstorage/interfaces.go` | two repository methods |
| `src/infrastructure/chatstorage/sqlite_repository.go` | migrations 49-50, both methods, six cleanup sites, text sanitisation |
| `src/infrastructure/chatstorage/sqlite_repository_debug_test.go` | migration count 48 → 50; slice pinned to `[43:48]` |
| `src/infrastructure/whatsapp/chatstorage_wrapper.go` | delegate both methods |
| `src/infrastructure/whatsapp/event_message_handler.go` | the audio branch in `handleMessage`; `handleWebhookForward` variadic |
| `src/infrastructure/whatsapp/event_message.go` | transcript threaded to `buildMediaFields`; `addTranscriptFields` |
| `src/infrastructure/whatsapp/agent_bridge.go` | `handleAgentBridgeWithText`, `agentSkipReasonWithText`, `directInboundSkipReason`, `detachedEventContext`, `runAgentBridge` text parameter |
| `src/infrastructure/whatsapp/agent_bridge_test.go` | two `runAgentBridge` call sites gain the text argument |
| `src/domains/chat/chat.go` | three `MessageInfo` fields |
| `src/usecase/chat.go` | `loadTranscripts` — one batch query per page |
| `src/usecase/chat_test.go` | stub gains the batch method; two hydration tests |
| `readme.md` | the transcription section, four env-table rows, `AGENT_TIMEOUT` default |

**No deployment runtime file was touched**: `docker-compose.yml`,
`docker/golang.Dockerfile`, `docker/entrypoint.sh` and everything under
`.github/workflows/` are unmodified. `GET /message/{id}/download` and the media
storage path are untouched (AC-17).

`src/.env` was given the live `ELEVENLABS_API_KEY` for manual validation. That
file is gitignored (`.gitignore:32`) and is **not** part of this change; the key
appears in no tracked file, no log line and no test.

## Structure

| Symbol | Role |
|--------|------|
| `elevenlabs.Transcribe` | one multipart POST; https enforced, redirects refused, size-capped, 401/403 → `ErrUnauthorized` |
| `elevenlabs.NormalizeLanguageCode` | `ara → ar`, `eng → en`, everything else sanitised and passed through |
| `transcriptionApplies` | the gate on the whole feature — key set, auto-download on, audio present, `directInboundSkipReason == ""` |
| `transcribeInboundAudio` | one attempt; always returns a final status, even on panic |
| `transcriptionCalls` | a second `agentGate` instance: 8 process-wide, 1 in flight per chat, 6/chat/minute |
| `persistTranscript` | the two writes, under their own budget so an expired stage still records its outcome |
| `logTranscriptionOutcome` | the single audit line — message, engine, audio duration, status, latency, language |
| `addTranscriptFields` | adds three webhook keys and removes none |
| `directInboundSkipReason` | the chat-shape guards, now shared by the bridge and transcription |
| `serviceChat.loadTranscripts` | one batch read per page, for audio messages only |

## How each panel finding landed

Every adopted finding from `plan.md > Panel response` is in the code:

- `[P-1]` `transcriptionCalls.acquire` is called in `handleMessage`
  (`event_message_handler.go`) **before** the `go` statement and refuses rather
  than queues; the stage then runs under
  `context.WithTimeout(ctx, config.ElevenLabsSTTTimeout)`. A refused message
  resolves to `failed` with no provider call and still reaches the webhook.
- `[P-2]` `transcriptionCalls = newAgentGate(sttMaxInFlight, sttPerChatPerMinute)`
  — 8 / 6-per-minute, so spend is rate-bounded and not merely concurrency-bounded.
- `[P-3]` `sanitizeTranscriptText` in the repository: `utf8.ValidString`, C0/DEL
  stripped with `\n` and `\t` preserved, rune-boundary truncation at 32 KiB.
  `NormalizeLanguageCode` charset-bounds the language before its `VARCHAR(32)`.
- `[P-4]` No existing call site changed: `handleWebhookForward`,
  `forwardMessageToWebhook`, `createWebhookEvent` and `buildEventPayload` all
  take `...*inboundTranscription`. The twelve `buildEventPayload` calls in
  `event_message_test.go` and the two in `event_message_handler_test.go` compile
  and pass untouched.
- `[P-5]` `sqlite_repository_debug_test.go` updated to 50 with the slice pinned
  to `[43:48]`; `TestMessageTranscriptSchemaIsPortable` covers 49-50 separately.
- `[P-6]` `audio.GetFileLength()` is checked against `elevenlabs.MaxAudioBytes`
  before the download, and `data = nil` releases the bytes before the agent and
  webhook stages.
- `[P-7]` `resolveEndpoint` refuses any non-`https` scheme (loopback carved out
  for `httptest`) before a request exists; `logSpeechToTextConfiguration`
  additionally reports it at startup through `utils.RedactURL`.
- `[P-8]` The part header is built with `textproto.MIMEHeader` from
  `audioPartType` (an allowlist) and `safeFilename` (`[A-Za-z0-9._-]`, 64 bytes).
- `[P-9]` `DeleteMessage` deletes on `(message_id, chat_jid)` — the scope the
  `messages` delete beside it uses, served by `idx_message_transcript_chat` — and
  `DeleteMessageByDevice` on the primary key.
- `[P-10]` `transcribeInboundAudio` recovers into a `failed` result, the agent
  call is wrapped in `withRecover`, so `handleWebhookForward` is reached on every
  path.
- `[P-11]` `config.PathMedia`, matching `buildMediaFields`.
- `[P-12]` `inboundTranscription.DownloadAttempted`; `buildMediaFields` skips the
  retry and emits no `audio` key, exactly as it does today on a failed download.
- `[P-13]` `Result` carries only `Text`, `LanguageCode` and `AudioDurationSec`.
- `[P-14]` Only `ara`/`eng` are mapped.
- `[P-15]` `duration_ms` is the audio duration (engine-reported, else
  `GetSeconds() * 1000`); latency is log-only.
- `[P-16]` `AgentTimeout` raised, with the comment stating plainly that no
  transcription latency is charged against it.
- `[P-17]` The Chatwoot latency consequence is documented in `readme.md`.
- `[P-18]` `ElevenLabsSTTTimeout` defaults to 30s and bounds the whole stage.
- `[P-19]` `detachedEventContext` extracted and shared.
- `[P-20]` Citations refreshed in `plan.md`.
- `[P-21]` `directInboundSkipReason` shared; group/broadcast/status/outbound
  audio is never transcribed. `spec.md` AC-2 amended to say so.
- `[P-22]` `GetMessageTranscriptBatch` keeps the explicit empty-device rejection.

The five declined findings are argued in `plan.md > Panel response > Declined`.

## Deviations from the plan

1. **Variadic instead of `...WithTranscription` wrappers.** The plan proposed a
   parallel set of `createWebhookEventWithTranscription` /
   `buildEventPayloadWithTranscription` functions. A variadic
   `...*inboundTranscription` parameter achieves the same two goals — no existing
   call site changes, and the value stays a real parameter rather than a hidden
   context value — with four fewer functions. `firstTranscription` unwraps it.
2. **`agent_bridge_test.go` added to the changed files.** The plan listed the
   `runAgentBridge` signature change but not the two test call sites it forces.
   Both gained the text argument; no assertion changed.
3. **Two test seams in `transcription.go`**, `extractAudioFn` and `transcribeFn`,
   following `submitWebhookFn` / `deliverAgentReplyFn`. Without them the stage's
   outcome mapping could not be tested without a live WhatsApp client and a paid
   provider call.
4. **`MaxAudioBytes` is exported** from `infrastructure/elevenlabs` rather than a
   package-private `sttMaxAudioBytes`. `[P-6]` requires the caller to refuse
   before downloading, which means the caller needs the number.
5. **`directInboundSkipReason` also rejects a nil event/message**, which
   `agentSkipReason` previously left to its callers' own nil guards. Behaviour is
   unchanged for every real caller; it makes the shared helper safe on its own.
6. **`readme.md` also updates the `AGENT_TIMEOUT` rows** (`90s → 120s`, flag and
   env table). The plan named the setting change but not its two documented
   defaults, which would otherwise have been left stating a value the binary no
   longer uses.

## Validation run

| Check | Command | Result |
|-------|---------|--------|
| build | `go build -C src ./...` | exit 0 |
| vet | `go vet -C src ./...` | exit 0 |
| new + affected tests | `go test -C src -tags purego -run "Transcri\|ElevenLabs\|..." ./...` | 62 pass, 0 fail |
| whole module (`purego`) | `go test -C src -tags purego ./...` | 4 failures — **identical to the parent branch** |
| whole module (cgo) | `go test -C src ./...` | 98 failures; the 11 new ones are the new SQLite tests hitting the same `CGO_ENABLED=0` stub as the 43 pre-existing chatstorage failures |

Full detail, including the parent-branch comparison, is in `verify.md`.
