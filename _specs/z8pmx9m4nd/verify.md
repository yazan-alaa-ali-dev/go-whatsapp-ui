---
ticket: z8pmx9m4nd
stage: verify
mode: standard
status: complete
owner: developer
updated: 2026-08-29
links:
  clickup: "https://app.clickup.com/t/z8pmx9m4nd"
  github: ""
---

# Verification — Make Hamsa the primary speech-to-text provider, with ElevenLabs Scribe v2 and OpenAI as ordered fallbacks

**Outcome: PASSED, with one explicitly stated limit** (AC-18's live half — see
[Limits](#limits-what-this-verification-does-not-prove)).

## Validation commands

The `go-source` profile, run from `src/`:

| Command | Result |
|---|---|
| `go build ./...` | clean |
| `go vet ./...` | clean |
| `go test ./...` | **111 failures before the change, 111 after** — no new failure |

**The baseline was measured, not assumed.** The entire working set (including
untracked files) was stashed, the suite run on the unmodified tree, and the work
restored. Of the 111, 105 are the `CGO_ENABLED=0` go-sqlite3 stub — this
toolchain cannot open a SQLite database at all — and the remainder resolve to one
genuine pre-existing failure: `TestResolveDocumentMIME/Zip` at `send_test.go:82`,
a Windows MIME-registry difference (`application/x-zip-compressed` vs
`application/zip`), the same failure recorded in ticket `z8pmx9kzc9`.

Packages this ticket touches or adds:

```
ok    infrastructure/stt          <- new
ok    infrastructure/elevenlabs   <- UNMODIFIED file, UNMODIFIED suite
ok    cmd
```

## Acceptance criteria

| AC | Result | Evidence |
|----|--------|----------|
| **AC-1** — `Provider` interface with three implementations; whatsapp imports no vendor | **PASS** | `TestRegistryHoldsTheImplementedProviders`; `TestWhatsAppPackageNamesNoVendor` scans every `.go` in `infrastructure/whatsapp` (including `_test.go`) for `infrastructure/elevenlabs|hamsa|openai` and finds none |
| **AC-2** — all couplings served by the neutral layer | **PASS** | `grep` for `elevenlabs` in `transcription.go` returns nothing. **Six** repointed, not five: the seam, `Enabled`, `Engine`, `MaxAudioBytes`, the classification switch, **and the `stageCtx` timeout** the panel found missing from revision 1 |
| **AC-3** — eight neutral kinds; the reason names the provider | **PASS** | `TestEveryFailureClassFailsOver` asserts the recorded kind per class; `TestReasonIsSingleLineForEveryKind`; `Reason()` leads with the provider name |
| **AC-4** — chain order from config; reordering changes the primary with no rebuild | **PASS** | `TestChainOrderComesFromConfiguration` reorders the list mid-test and the *same binary* calls a different vendor first. Confirmed at runtime: `chain=hamsa -> elevenlabs -> openai primary=hamsa/s2` |
| **AC-5** — all seven failure classes **and a panic** fail over | **PASS** | `TestEveryFailureClassFailsOver`, 9 sub-cases: rejected key, quota, region block, rate limit, malformed body, connection failure, vendor down, an unclassified error, and a **panicking provider**. Each asserts the fallback transcribed and the stored engine is the fallback's |
| **AC-6** — two failures reach the third, once each, in order | **PASS** | `TestSecondFailureReachesThirdProvider` asserts `1/1/1` calls and `engine=openai/test` |
| **AC-7** — `no_speech` stops the chain | **PASS** | `TestNoSpeechDoesNotTriggerFailover` — the later providers record **0** calls. Structural, not a special case: an empty-text success is `err == nil` and the loop returns on the first non-error |
| **AC-8** — total failure still yields a final status and a dispatched webhook | **PASS** | `TestEveryProviderFails` returns a classified error carrying every attempt; `transcribeInboundAudio` still always returns a result, and `event_message_handler.go` still dispatches the webhook after it. The existing `TestHandleMessageDispatchesVoiceNoteWebhookAfterTranscription` passes unchanged |
| **AC-9** — audio downloaded once, same bytes to each attempt | **PASS** | `TestSameAudioReachesEveryAttempt` compares the **backing array pointer** (`&got[0] == &audio[0]`) for all three providers — proving no defensive copy, which at 16 MiB per provider would have been the expensive way to pass this test |
| **AC-10** — own budgets, and an expired ceiling starts nothing more | **PASS** | `TestHungPrimaryStillLeavesBudgetForFallbacks` (the panel's finding), `TestFastFailureHandsSurplusToTheNextProvider`, `TestExpiredCeilingDoesNotStartRemainingProviders` |
| **AC-11** — smallest limit, applied before any byte is fetched | **PASS** | `TestMaxAudioBytesIsTheSmallestActiveLimit` asserts the min over a 4 MiB / 25 MiB chain and that **no provider was called** for oversized audio. Runtime: `max_audio_bytes=16777216` |
| **AC-12** — unconfigured provider skipped with one warning | **PASS** | `TestUnconfiguredProviderIsSkippedWithOneWarning`. Runtime: exactly one warning naming `hamsa`, the process **started**, and no per-message error |
| **AC-13** — unknown name stops startup, naming it | **PASS** | `TestUnknownProviderNameIsAStartupError`. Runtime, real binary: `level=fatal msg="configuration error: STT_PROVIDER_CHAIN names 1 unknown provider(s): deepgram. Known providers are: elevenlabs, hamsa, openai"` |
| **AC-14** — legacy deployment unchanged | **PASS** | `TestNoChainVariableKeepsTodaysElevenLabsBehaviour` asserts chain, `Engine()=="elevenlabs/scribe_v2"` and `MaxAudioBytes()==16 MiB`. **Strongest evidence:** `git diff --stat src/infrastructure/elevenlabs/` is empty and its 541-line suite passes unmodified. Runtime with only `ELEVENLABS_API_KEY`: identical engine string, identical limit, `stage_ceiling=30s` |
| **AC-15** — nothing configured is silent | **PASS** | `TestNothingConfiguredIsTheDisabledState`; `transcriptionApplies` gates on `stt.Enabled()`, and the existing `TestTranscriptionAppliesGating` passes unchanged |
| **AC-16** — no key and no transcript in any error, reason, row or log | **PASS** | `TestProvidersNeverLeakTheAPIKeyIntoAnError` points each provider at a server whose **error body echoes the key**, asserting it appears in neither the error nor `Reason()`. `TestUnparseableSuccessBodyIsNeverQuoted` asserts a 2xx parse failure reports only the body's **length** — that body is the customer's words |
| **AC-17** — https enforced, redirects refused | **PASS** | `TestProvidersRefusePlaintextEndpoints`; `TestProvidersDoNotFollowRedirects` asserts the redirect target received **0 hits** — the key and the recording were not replayed |
| **AC-18** — mechanism decided and justified; no public URL; model and language configurable | **PASS (send half) / LIMIT (live half)** | `plan.md` decides the **synchronous realtime route** against all three candidates. `TestHamsaUsesSynchronousRouteAndNeverSendsAMediaURL` asserts the path is `/v1/realtime/stt`, that **no** `mediaUrl`, `webhookUrl`, `webhookAuth` or `processingType` is sent, that the audio round-trips as base64, and that model and language came from configuration. **See [Limits](#limits-what-this-verification-does-not-prove)** |
| **AC-19** — gate re-examined; concurrency unchanged | **PASS** | `plan.md > Admission gate` — kept at `newAgentGate(8, 6)` with the arithmetic. The chain is sequential inside one slot, and because the ceiling **did not move** (30s), slot occupancy, throughput and the per-chat window are byte-for-byte today's. This is only true because the panel's proportional-budget finding was adopted |
| **AC-20** — a fourth vendor is one file plus one registry entry | **PASS** | `TestWhatsAppPackageNamesNoVendor` is the structural proof; `builders` in `registry.go` is the single edit point |
| **AC-21** — chain, states, ceiling and budgets reported at startup | **PASS** | Runtime output quoted in `implement.md`: chain, primary, ceiling, max bytes, then one line per provider with its own budget. No key printed; URLs go through `utils.RedactURL` |
| **AC-22** — no deployment runtime file modified | **PASS** | `git status --porcelain` filtered on `docker-compose\|golang.Dockerfile\|entrypoint.sh\|.github/workflows` returns **0 lines** |

**22 of 22 acceptance criteria mapped to an executed result.** 21 pass outright;
AC-18 passes on everything reachable without vendor credentials and carries a
stated limit on the half that is not.

## Test cases

TC-1 … TC-16 are implemented and passing (see the AC table for the mapping).
**TC-17 (manual, live Hamsa) was not run** — see below. TC-18 is the AC-22
`git` check, executed above.

## Runtime impact

**Yes — this ticket changes runtime behaviour**, and deliberately so. What
changes, and what does not:

| | Before | After |
|---|---|---|
| Providers per voice note | 1 | up to 3, sequentially, stopping at the first success |
| Webhook / Chatwoot delay ceiling | 30s | **30s — unchanged** |
| Admission slots, per-chat rate | 8 / 6 per min | **unchanged** |
| Slot occupancy | ≤ ceiling | **unchanged** — the ceiling did not move |
| Process-wide concurrency | 8 | **unchanged** — the chain is sequential inside one slot |
| Stored `engine` | always `elevenlabs/scribe_v2` | the provider that produced the text |
| Idle connection pools | 1 | one per configured provider (NFR-1 restated honestly after the security lens) |
| A deployment that edits no configuration | — | **byte-for-byte the same behaviour** |

No deployment runtime file changed. No schema change, no migration, no new
column, no webhook payload change, no new inbound endpoint.

**Rollback is configuration-level and needs no deploy:** `STT_PROVIDER_CHAIN=elevenlabs`,
or removing the variable, restores exactly today's behaviour. That is the point
of the abstraction, and AC-14 is the test that says it works.

## Limits — what this verification does *not* prove

Stated here rather than left to be found later.

1. **Hamsa has never been called for real.** TC-17 needs credentials this
   environment does not have. Two things only a live call can settle:
   - **Does the realtime endpoint accept ogg/opus?** A WhatsApp voice note is
     `audio/ogg; codecs=opus`; Hamsa documents "any audio format supported by the
     backend (WAV, MP3, etc.)" without naming ogg, and transcoding is out of
     scope. If it refuses, Hamsa returns `bad_response` and **the chain fails
     over to ElevenLabs on every voice note** — the deployment keeps
     transcribing, which is the feature working, but Hamsa would be primary in
     name only.
   - **Is the auth scheme `Token` or `Bearer`?** The vendor's own API reference
     and its STT quickstart disagree. `HAMSA_AUTH_SCHEME` exists precisely so
     this is a configuration fix rather than a redeploy.

   Neither risk can break an existing deployment: both fail *closed into the
   fallback*, and the chain is opt-in — Hamsa is not in anyone's chain until an
   operator puts it there.

2. **OpenAI has likewise never been called for real.** Its contract is better
   documented (`ogg` is on the published supported-format list, 25 MiB limit) and
   it is covered by `httptest` against the documented shapes, but the same
   caveat applies.

3. **The SQLite-backed tests could not run** on this toolchain
   (`CGO_ENABLED=0`). This is pre-existing and identical before and after, but it
   means the transcript-row *persistence* path is exercised only through the
   in-memory fakes, not against a real database. Nothing in this ticket changes
   that path — `persistTranscript` and the `MessageTranscript` shape are
   untouched — but the coverage gap is real and is not new.

## Sign-off

All 22 acceptance criteria mapped to executed results; no new test failure
against a measured baseline; no deployment runtime file touched; the audited
ElevenLabs client byte-for-byte unchanged. The one unproven half of AC-18 is
recorded above rather than papered over with a test that would only have
confirmed our own mock.

Ticket state: `implemented → verified → closed`.
