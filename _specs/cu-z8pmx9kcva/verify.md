---
ticket: cu-z8pmx9kcva
stage: verify
mode: standard
status: complete
owner: developer
updated: 2026-08-20
links:
  clickup: "https://app.clickup.com/t/z8pmx9kcva"
  github: ""
---

# Verification — cu-z8pmx9kcva

Outcome: **PASSED**. Every acceptance criterion in `spec.md` is mapped to an
executed result below.

## Runtime-impact statement

**No deployment runtime file changed.** `docker-compose.yml`,
`docker/golang.Dockerfile`, `docker/entrypoint.sh`,
`.github/workflows/build-docker-image.yaml`, `.github/workflows/release.yml` and
`.github/workflows/set-latest-tag.yaml` are byte-identical to the parent branch.
Confirmed by `git diff --stat ticket/cu-z8pmx9kcvd`, whose file list contains
none of them.

Two **behavioural** runtime impacts do exist and are deliberate:

1. **A voice note's webhook is delayed** by up to `ELEVENLABS_STT_TIMEOUT` (30s
   by default), because AC-9 requires the transcript status to be final when the
   webhook is dispatched. The same fan-out feeds Chatwoot
   (`webhook_forward.go:139-141`), so a voice note reaches a Chatwoot inbox that
   much later too, and after a text message sent behind it in the same chat.
   Documented in `readme.md` as an accepted trade.
2. **`AGENT_TIMEOUT` default rises 90s → 120s** (AC-16), which applies to every
   agent call on every deployment, not only to transcribed ones. Worst-case
   resource hold per agent call rises with it: 32 in-flight × 120s. For one voice
   note the end-to-end worst case is 30s transcription + 120s agent + 30s
   delivery ≈ 3 minutes of held goroutine and socket. Re-tuning
   `agentMaxInFlight` was declined as out of scope (`plan.md > Declined`).

With `ELEVENLABS_API_KEY` empty — the default — neither impact exists: the audio
branch of `handleMessage` is never taken, and the only change any deployment sees
is the `AGENT_TIMEOUT` default.

## Acceptance criteria

| AC | Result | Evidence |
|----|--------|----------|
| **AC-1** migration creates `message_transcript` with the named columns, keyed `(device_id, message_id)` | **PASS** | Migration 49 in `sqlite_repository.go > getMigrations`. `TestMessageTranscriptSchemaIsPortable` pins that 49-50 are appended, hold one statement each, and use nothing PostgreSQL rejects. `TestSetMessageTranscriptRoundTripsArabic` reads every column back. Numbered 49, not 47 — see `ticket.md > Execution context`. |
| **AC-2** inbound direct audio transcribed via `model_id=scribe_v2` before the agent is called | **PASS** | `TestTranscribeSendsScribeV2AndOmitsLanguageByDefault` asserts `model_id=scribe_v2` on the wire. `TestTranscriptionAppliesGating` (6 cases) pins the entry set. Ordering is structural: `handleMessage` runs `transcribeInboundAudio` then `handleAgentBridgeWithText` in one goroutine. |
| **AC-3** the text reaches the agent in the `text` field a typed message uses | **PASS** | `handleAgentBridgeWithText(..., result.Text)` feeds the same `runAgentBridge` → `buildAgentRequest` path, unchanged. `TestAgentSkipReasonAcceptsTranscribedVoiceNote` pins that a voice note is refused with no transcript and accepted with one. |
| **AC-4** persisted and exposed as `transcript` on `MessageInfo`, always, no query parameter | **PASS** | `TestGetChatMessagesReturnsTranscriptAlways` — no request field is consulted; the transcript is present on the audio message and absent from the text message. |
| **AC-5** status records at least `pending`, `done`, `failed`, `no_speech` | **PASS** | Four constants in `domains/chatstorage`. `TestTranscribeInboundAudioHappyPath` asserts the write sequence is exactly `[pending done]`. `…NoSpeech`, `…ProviderFailure` (2 sub-cases) and `…RefusedByGate` cover the other three. `TestSetMessageTranscriptRejectsUnknownStatus` pins that no fifth value can be stored. |
| **AC-6** detected language persisted as a code and returned next to the transcript | **PASS** | `TestNormalizeLanguageCode` (`ara → ar`, `eng → en`, pass-through). `TestTranscribeInboundAudioHappyPath` (`Language == "ar"`), `TestSetMessageTranscriptRoundTripsArabic` (column), `TestGetChatMessagesReturnsTranscriptAlways` (API), `TestWebhookPayloadCarriesTranscriptFields` (webhook). |
| **AC-7** webhook carries `transcript`, `transcript_language`, `transcript_status` beside `audio` | **PASS** | `TestWebhookPayloadCarriesTranscriptFields` (3 cases) and, end to end through `handleMessage`, `TestHandleMessageDispatchesVoiceNoteWebhookAfterTranscription`. |
| **AC-8** every existing webhook field untouched; transcript added, never substituted | **PASS** | Same two tests assert `audio` keeps its path shape and `body` keeps its current (empty) value. `TestWebhookPayloadUnchangedWithoutTranscription` asserts no key is added when transcription is not in play. |
| **AC-9** webhook dispatched **after** the attempt resolves; status never `pending` | **PASS** | `TestHandleMessageDispatchesVoiceNoteWebhookAfterTranscription` uses a deliberately slow provider and fails if the webhook is observed before the transcription completed; it then asserts `transcript_status == "done"`. |
| **AC-10** no language forced; `ELEVENLABS_STT_LANGUAGE` exists and is empty by default | **PASS** | `TestTranscribeSendsScribeV2AndOmitsLanguageByDefault` fails if `language_code` appears at all. `TestTranscribeSendsLanguageOnlyWhenPinned` covers the escape hatch. Default is `""` in `config/settings.go`. |
| **AC-11** Arabic in Arabic script (`ar`), English in English (`en`), neither converted | **PASS** | `TestTranscribeSendsScribeV2AndOmitsLanguageByDefault` round-trips a real Gulf-dialect sentence; `TestTranscribeKeepsEnglishInEnglish` the English case. `TestSetMessageTranscriptRoundTripsArabic` proves the Arabic survives storage byte-for-byte. |
| **AC-12** failure → `status=failed`, audio still delivered, agent flow not aborted, webhook still sent with no transcript text | **PASS** | `TestTranscribeInboundAudioProviderFailure` (both sub-cases) asserts `failed`, empty text, and that `Media` — the downloaded audio — is still carried forward. `TestWebhookPayloadCarriesTranscriptFields/failed…` asserts the `transcript` key is absent while `audio` is present. |
| **AC-13** empty result → `no_speech`, no text to the agent, webhook still sent | **PASS** | `TestTranscribeInboundAudioNoSpeech`; `TestAgentSkipReasonAcceptsTranscribedVoiceNote` pins that an empty transcript is refused by the bridge as "no text content". |
| **AC-14** 401/403 logged with the message id and an authorization class; audio still stored; webhook still `failed`; no malformed agent request | **PASS** | `TestTranscribeReportsUnauthorized` (sentinel returned, credential never echoed into the error). `TestTranscribeInboundAudioProviderFailure/invalid credentials` asserts the failed status and the surviving audio. The `[STT]` log line names the message id and device; the agent is never called because the bridge refuses an empty text. |
| **AC-15** attempt bounded by a timeout; on expiry the webhook goes out `failed` | **PASS** | `context.WithTimeout(ctx, config.ElevenLabsSTTTimeout)` wraps the download and the provider call; an expired context surfaces as a provider error, which `TestTranscribeInboundAudioProviderFailure` maps to `failed`. The database writes use their own budget derived from the detached context, so the outcome is still recorded. |
| **AC-16** agent timeout raised | **PASS** | `config.AgentTimeout = 120 * time.Second`, flag and readme updated. Recorded honestly per `[P-16]`: this is a documentation-level change with no measurable effect on the voice path. |
| **AC-17** `media_type=audio`, filename and download route unchanged | **PASS** | `git diff` touches neither the media download route nor `ExtractMediaInfo`. `TestGetChatMessagesReturnsTranscriptAlways` asserts `media_type` and `filename` are untouched and that `content` stays empty. |
| **AC-18** each transcription logs message id, engine, audio duration and outcome; no secret, audio or transcript in a log line | **PASS** | `logTranscriptionOutcome` emits exactly one line with all four plus latency and language. `elevenlabs` logs nothing at all. `TestTranscribeInboundAudioHappyPath` asserts `duration_ms == 4500` — the engine's audio duration, not a latency. |
| **AC-19** empty key ⇒ entirely inert | **PASS** | `TestTranscribeWithoutKeyMakesNoRequest`, `TestTranscriptionAppliesGating/no API key configured`, `TestHandleMessageLeavesNonAudioPathUnchanged`, `TestWebhookPayloadUnchangedWithoutTranscription`. |

## Test execution

| Check | Command | Result |
|-------|---------|--------|
| build | `go build -C src ./...` | exit 0 |
| vet | `go vet -C src ./...` | exit 0 |
| new + affected | `go test -C src -tags purego -run "Transcri\|ElevenLabs\|Multipart\|NormalizeLanguage\|AudioPartType\|WebhookPayload\|HandleMessage\|AgentSkipReason\|GetChatMessages\|GetMessageTranscript\|SetMessageTranscript\|Delete…\|MessageDebugSchema" ./...` | **62 pass, 0 fail** |
| ticket 06 regression | `go test -C src -run "Agent\|ExtractGenuineText" ./infrastructure/whatsapp/` | 19 pass, 0 fail — unchanged |
| whole module (`purego`) | `go test -C src -tags purego ./...` | 4 failures |
| whole module (cgo) | `go test -C src ./...` | 98 failures |

### Parent-branch comparison

The parent branch `ticket/cu-z8pmx9kcvd` was checked out in a temporary
`git worktree` and the same two commands run there.

| Build | Parent branch | This branch | New failures |
|-------|---------------|-------------|--------------|
| `-tags purego` | 4 | 4 | **0** |
| default (cgo) | 87 | 98 | 11 |

Under `purego` the failure sets are **identical**, name for name:
`TestResolveDocumentMIME` (+ its `/Zip` sub-test) and
`TestSQLiteRepositoryEditTestSuite` (+ its
`/TestCreateMessageStoresEditHistoryAndUpdatesOriginalMessage`). Both pre-date
this ticket and are unrelated to it.

Under the default build the 11 additional names are exactly this ticket's 11 new
SQLite-backed tests:

    TestSetMessageTranscriptRoundTripsArabic
    TestSetMessageTranscriptUpsertsPendingIntoFinal
    TestSetMessageTranscriptRejectsUnknownStatus
    TestSetMessageTranscriptSanitisesText
    TestSetMessageTranscriptTruncatesRatherThanRejects
    TestGetMessageTranscriptBatchIsDeviceScoped
    TestGetMessageTranscriptBatchRejectsEmptyDevice
    TestDeleteMessageRemovesOnlyItsOwnTranscript
    TestDeleteChatByDeviceRemovesTranscripts
    TestDeleteDeviceDataRemovesTranscripts
    TestMessageTranscriptSchemaIsPortable

They fail with `Binary was compiled with 'CGO_ENABLED=0', go-sqlite3 requires cgo
to work. This is a stub` — the same single cause as the 43 pre-existing
`infrastructure/chatstorage` failures on the parent branch. They are new tests
hitting a pre-existing environment limitation, not a new defect: all eleven pass
under `-tags purego` (modernc, no cgo), which is why that build is the meaningful
comparison. This is the same measurement ticket 10 recorded.

`comm -23` in both directions confirms no test that passed on the parent fails
here, and no test that failed on the parent passes here by accident.

## What was NOT verified by automated test

- **A live ElevenLabs round trip.** Every provider test runs against an
  `httptest` server. The request shape is asserted on the wire (endpoint, header,
  `model_id`, the absence of `language_code`, the multipart part headers) against
  the published API contract, but no automated test spends money or requires
  network access. The live key is configured in the gitignored `src/.env` for the
  operator to exercise the two manual cases: one Arabic voice note and one
  English voice note through a paired device, checking `transcript` and
  `transcript_language` on `GET /chat/{jid}/messages`, the webhook payload, and
  the agent's reply.
- **`scribe_v2` availability.** The model id is pinned by AC-2 and asserted to be
  what is sent; whether the account is entitled to it is a vendor-side fact.
- **Behaviour under real concurrency at 8 in-flight.** The bounds are unit-tested
  through `agentGate`'s own ticket-06 tests (which pass unchanged); no load test
  was run.
