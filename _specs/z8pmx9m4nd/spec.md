---
ticket: z8pmx9m4nd
stage: spec
mode: standard
status: complete
owner: developer
updated: 2026-08-29
links:
  clickup: "https://app.clickup.com/t/z8pmx9m4nd"
  github: ""
---

# Specification — Make Hamsa the primary speech-to-text provider, with ElevenLabs Scribe v2 and OpenAI as ordered fallbacks

## Business goal

Voice-note transcription today has exactly one engine and no way to change it
without a rebuild. `src/infrastructure/elevenlabs/stt.go` is reached through a
single seam in `src/infrastructure/whatsapp/transcription.go`, and four further
couplings (`Enabled()`, `Engine()`, `MaxAudioBytes`, the sentinel-error switch)
name the vendor directly. When that vendor's key expires, its quota runs out, its
region block trips, or it is simply down, every inbound voice note in the
deployment silently becomes `failed` — and the only remedy is an engineer, a
commit and a redeploy.

This ticket removes the vendor from the message path. Transcription becomes an
**ordered chain declared in configuration**: the first provider that returns text
wins, any failure of one advances to the next, and swapping the primary vendor —
including to a vendor that is implemented but currently unused — becomes an
`.env` edit. Hamsa becomes the primary, ElevenLabs the first fallback, OpenAI the
second.

The change is deliberately confined to the **inbound voice-note transcription
path**. It adds no outbound behaviour, no new public endpoint, and no new stored
column.

## User story

As **an operator running voice-note transcription in production**, I want
**Hamsa to transcribe first and another engine to take over silently the moment
Hamsa fails — for whatever reason**, so that **a customer's voice note still
becomes text when a key expires, a quota runs out, a region is blocked or the
vendor is simply down — and so that replacing the primary vendor later is an
`.env` edit, not a code change and a redeploy**.

## Functional requirements

### Provider abstraction

- **REQ-1** One `Provider` interface describes one transcription attempt for one
  vendor. ElevenLabs, Hamsa and OpenAI are three implementations of it.
- **REQ-2** No package outside the neutral speech-to-text package names a vendor.
  All five of today's couplings in `transcription.go` — the `transcribeFn` seam,
  `Enabled()`, `Engine()`, `MaxAudioBytes` and the sentinel-error classification
  switch — go through the neutral layer.
- **REQ-3** Failure classification is provider-neutral: a fixed set of neutral
  error kinds (`unauthorized`, `quota_exceeded`, `region_blocked`,
  `rate_limited`, `bad_response`, `timeout`, `network`, `unavailable`) that each
  provider maps its own statuses and bodies onto.
- **REQ-4** The operator-facing reason string names **which provider** produced
  the failure.
- **REQ-5** Adding a fourth vendor is one new file implementing the interface plus
  one registry entry — no edit to the whatsapp package.

### Configuration-driven ordering

- **REQ-6** The chain is an ordered list in configuration. Position in the list
  **is** priority; the first entry is the primary.
- **REQ-7** Changing the primary — including to an implemented but unused vendor —
  requires editing that list only. No Go file change, no rebuild.
- **REQ-8** Each provider carries an independent settings block (key, base URL,
  model, language, timeout, optional proxy), bound as both environment variables
  and flags, following the existing `ELEVENLABS_*` pattern.
- **REQ-9** A provider named in the chain but missing its credentials is skipped
  with **one** startup warning. It is not a startup failure and not a per-message
  error.
- **REQ-10** An **unknown** name in the chain stops the process at startup with an
  error naming the offending entry.
- **REQ-11** A chain in which no provider is configured is the disabled state, and
  it is silent — identical in observable behaviour to today's empty
  `ELEVENLABS_API_KEY`.
- **REQ-12** Existing `ELEVENLABS_*` variables keep working unchanged. A
  deployment upgraded without any `.env` edit still transcribes through
  ElevenLabs.

### Failover behaviour

- **REQ-13** **Any** failure of a provider advances to the next in the chain:
  rejected key, exhausted quota, region block, rate limit, malformed body,
  connection failure, timeout, or a panic inside the provider.
- **REQ-14** A provider that succeeds **with no speech** has not failed. The chain
  stops there and no further vendor is called.
- **REQ-15** A provider that returns text stops the chain immediately. There is no
  comparison and no second opinion.
- **REQ-16** Failover is not a retry: each provider is attempted **at most once**
  per message and is never re-entered later in the same chain.
- **REQ-17** The stored `engine` on a successful transcript is the provider that
  actually produced the text.
- **REQ-18** Each attempt writes one audit line carrying the provider, the neutral
  failure kind and the latency.
- **REQ-19** When every provider fails, the outcome is today's outcome: `failed`
  status, transcript row persisted, webhook still dispatched. No path ends
  without a final status.

### Time and cost bounds

- **REQ-20** Each provider has its own per-attempt timeout budget.
- **REQ-21** The whole stage is bounded by **one** operator-visible ceiling, which
  is the stated maximum a webhook consumer can wait.
- **REQ-22** When the ceiling expires, the providers not yet started are not
  started, and the outcome is `failed`.
- **REQ-23** The audio is downloaded **once** and the same bytes are handed to
  each attempt in turn.
- **REQ-24** The pre-download size refusal survives; the effective limit is the
  **smallest** limit among the providers active in the chain, applied before any
  byte is fetched.
- **REQ-25** The admission gate is re-examined against a chain that can cost up to
  three vendor calls per admitted slot, and the resulting numbers are justified.

### Hamsa's transport contract

- **REQ-26** The media-delivery mechanism is decided and justified before
  implementation, against the submit+poll / callback / WebSocket candidates.
- **REQ-27** If a `mediaUrl` is used, the recording is not exposed at an
  unauthenticated, guessable or long-lived URL.
- **REQ-28** The existing guarantee is preserved: the outbound webhook for an
  audio message carries a **final** `transcript_status`.
- **REQ-29** Hamsa's `language` and `model` are configuration, not constants.

### Privacy and secrets

- **REQ-30** Transcript text is never logged, by any provider.
- **REQ-31** No API key appears in a log line, an error string, a stored row or a
  webhook payload, for any vendor.
- **REQ-32** Every provider refuses redirects and refuses a non-`https` endpoint,
  exactly as `elevenlabs` does today.

## Non-functional requirements

- **NFR-1 — No new concurrency.** The chain is **sequential inside one admitted
  slot**. Process-wide in-flight transcriptions, goroutines and open sockets are
  unchanged by this ticket; only the work done inside one slot changes.
- **NFR-2 — The single-provider path is behaviour-preserving.** With a chain of
  exactly `elevenlabs`, the request built, the guards applied and the stored row
  written are the same as before this ticket.
- **NFR-3 — Bounded wait.** The stage ceiling is the only number a webhook
  consumer needs, and its default is unchanged at 30s for a deployment that does
  not edit its configuration.
- **NFR-4 — No new stored column and no webhook payload change.** The transcript
  row keeps its shape; only the value written to `engine` can now name a
  different vendor.
- **NFR-5 — Startup diagnosability.** The effective chain, each provider's
  configured/skipped state, the ceiling and the per-provider budgets are reported
  once at boot, with every URL through the redactor and no key printed.

## Constraints

- **C-1** No deployment runtime file is touched (`docker-compose.yml`,
  `docker/golang.Dockerfile`, `docker/entrypoint.sh`, the three release
  workflows).
- **C-2** No new third-party Go dependency. The two new providers use
  `net/http` and `encoding/json` only, like the existing one.
- **C-3** No transcoding of the audio. The bytes WhatsApp delivered are the bytes
  every provider receives.
- **C-4** No new inbound HTTP endpoint and no new public URL for media.
- **C-5** The `no retry anywhere` rule holds: a chain is not a retry, and no
  provider is called twice.

## Acceptance criteria

| ID | Criterion | Requirements |
|----|-----------|--------------|
| **AC-1** | A `Provider` interface exists in a neutral speech-to-text package with ElevenLabs, Hamsa and OpenAI as three implementations; `infrastructure/whatsapp` imports no vendor package. | REQ-1, REQ-2 |
| **AC-2** | All five of today's couplings in `transcription.go` are served by the neutral layer: the seam, `Enabled()`, `Engine()`, `MaxAudioBytes` and the classification switch. | REQ-2, REQ-3, REQ-4 |
| **AC-3** | Failure classification uses the eight neutral kinds, and the reason string recorded for a failure names the provider that produced it. | REQ-3, REQ-4 |
| **AC-4** | With `STT_PROVIDER_CHAIN=hamsa,elevenlabs,openai` and all three configured, a voice note that Hamsa transcribes calls Hamsa only, and the stored `engine` names Hamsa. Reordering the list to put another vendor first changes which vendor is called, with no Go file changed and no rebuild. | REQ-6, REQ-7, REQ-17 |
| **AC-5** | Each of the seven failure classes of a primary — rejected key, quota, region block, rate limit, malformed body, connection failure, timeout — **and** a panic inside the provider, advances to the next provider, which transcribes; status is `done` and the stored `engine` is the fallback. | REQ-13, REQ-17 |
| **AC-6** | With the first two providers failing and the third succeeding, all three are called exactly once each, in chain order, and the stored `engine` is the third. | REQ-15, REQ-16, REQ-17 |
| **AC-7** | A provider that succeeds with empty text yields `no_speech`, and no later provider is called. | REQ-14 |
| **AC-8** | When every provider fails, status is `failed`, the transcript row is persisted, and the outbound webhook is still dispatched with a final status — indistinguishable from today's single-provider failure. | REQ-19, REQ-28 |
| **AC-9** | For a chain in which the first providers fail, `extractAudioFn` is invoked exactly once and the identical bytes reach every attempt. | REQ-23 |
| **AC-10** | Each provider is given its own per-attempt budget; and when the stage ceiling expires during an attempt, the providers after it are never started and the outcome is `failed`. | REQ-20, REQ-21, REQ-22 |
| **AC-11** | The pre-download size refusal uses the smallest limit among the active providers and is applied before any byte is fetched. | REQ-24 |
| **AC-12** | A provider named in the chain with empty credentials produces exactly one startup warning naming it, the process starts normally, the next configured provider transcribes, and no per-message error is produced for the skipped one. | REQ-9 |
| **AC-13** | An unknown name in the chain stops startup with an error naming that entry. | REQ-10 |
| **AC-14** | A deployment with only `ELEVENLABS_API_KEY` set and no chain variable transcribes through ElevenLabs exactly as before this ticket — same request, same guards, same stored `engine` value — with no configuration edit. | REQ-12, NFR-2 |
| **AC-15** | With no provider configured, `transcriptionApplies` is false, the message follows the pre-feature path, and nothing is logged per message. | REQ-11 |
| **AC-16** | No API key appears in any log line, error string, stored row or webhook payload, and no transcript text appears in any log line, for any of the three vendors — including when the vendor's error body echoes the request. | REQ-30, REQ-31 |
| **AC-17** | Every provider refuses a non-`https` endpoint and refuses to follow a redirect. | REQ-32 |
| **AC-18** | Hamsa's media-delivery mechanism is decided and justified in `plan.md` before implementation, against the three candidates; the recording is never placed at an unauthenticated public URL; and Hamsa's `model` and `language` are configuration. | REQ-26, REQ-27, REQ-29 |
| **AC-19** | The admission gate numbers are re-examined against the three-call chain and the decision is justified in `plan.md`; process-wide concurrency is unchanged. | REQ-25, NFR-1 |
| **AC-20** | Adding a further vendor requires one new file and one registry entry, with no edit to `infrastructure/whatsapp` — demonstrated structurally. | REQ-5 |
| **AC-21** | The effective chain, each provider's state, the ceiling and the per-provider budgets are reported once at startup, with URLs redacted and no key printed. | NFR-5 |
| **AC-22** | No deployment runtime file is modified. | C-1 |

## Test cases

| ID | Case | Covers |
|----|------|--------|
| **TC-1** | Chain `hamsa,elevenlabs,openai`, Hamsa returns text → only Hamsa called, `engine` names Hamsa. Then chain `openai,hamsa` with the same binary → OpenAI called first. | AC-4 |
| **TC-2** | Table over the seven failure classes plus a panicking provider; each asserts the second provider was called and produced the stored transcript. | AC-5, AC-3 |
| **TC-3** | First two fail, third succeeds → three calls, chain order, one call each, `engine` = third. | AC-6 |
| **TC-4** | Primary returns success with empty text → `no_speech`, later providers never called. | AC-7 |
| **TC-5** | All providers fail → `failed`, row persisted, webhook dispatched with a final status. | AC-8 |
| **TC-6** | Chain with two failing providers → `extractAudioFn` called once; every attempt receives byte-identical audio. | AC-9 |
| **TC-7** | Primary consumes its whole per-provider budget → the fallback still receives its own budget; and a stage ceiling that expires during the second attempt → third never started, status `failed`. | AC-10 |
| **TC-8** | `MaxAudioBytes` over a mixed chain returns the smallest active limit, and an oversized declared length is refused before `extractAudioFn` runs. | AC-11 |
| **TC-9** | Chain naming a provider with an empty key → one warning, no error, the provider is absent from the active chain. | AC-12 |
| **TC-10** | Chain naming an unknown provider → configuration returns an error naming it. | AC-13 |
| **TC-11** | No chain variable, `ELEVENLABS_API_KEY` set → active chain is exactly `elevenlabs`, `Engine()` is today's string, `MaxAudioBytes()` is today's value; the existing ElevenLabs client tests continue to pass unchanged. | AC-14 |
| **TC-12** | No chain variable, no keys → `Enabled()` false and `transcriptionApplies` false. | AC-15 |
| **TC-13** | Each new provider against an `httptest` server returning an error body that echoes the API key → the key appears in no returned error string; a successful transcript never reaches a log line. | AC-16 |
| **TC-14** | Each new provider against a plain-`http` base URL → refused without a request; against a 3xx → refused and not followed. | AC-17 |
| **TC-15** | Hamsa provider against an `httptest` server: asserts the synchronous request shape, that no `mediaUrl` and no callback URL are sent, and that model and language come from configuration. | AC-18 |
| **TC-16** | Registry contains exactly the three names; `infrastructure/whatsapp` source contains no vendor package import. | AC-1, AC-20 |
| **TC-17** | Manual: real Hamsa credentials and an Arabic voice note end to end; then Hamsa credentials deliberately invalidated, confirming ElevenLabs takes over and the stored `engine` says so. | AC-4, AC-5, AC-18 |
| **TC-18** | `git diff --name-only` over the branch shows no deployment runtime file. | AC-22 |

## Out of scope

- Outbound text-to-speech, and any use of Hamsa or OpenAI outside inbound
  voice-note transcription.
- Transcoding, resampling or re-containering the audio.
- Video notes and any media type other than a plain audio message.
- A public or signed media URL, a Hamsa callback endpoint, and the Hamsa
  WebSocket channel.
- Comparing transcription quality between vendors, or choosing between them on
  anything other than configured order and success.
- Changing the transcript row's schema, the webhook payload, or the agent bridge.
- Retry of any kind, including retrying a provider later in the same chain.
- Per-device or per-account chain overrides — the chain is process-wide.
