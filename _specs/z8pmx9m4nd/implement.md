---
ticket: z8pmx9m4nd
stage: implement
mode: standard
status: complete
owner: developer
updated: 2026-08-29
links:
  clickup: "https://app.clickup.com/t/z8pmx9m4nd"
  github: ""
---

# Implementation — Make Hamsa the primary speech-to-text provider, with ElevenLabs Scribe v2 and OpenAI as ordered fallbacks

Applied on branch `ticket/z8pmx9m4nd`, cut from `ticket/z8pmx9kzca` — the only
tip carrying ticket 07's transcription path (`main` does not have it yet).

## Files changed

### New — `src/infrastructure/stt/` (2,915 lines including tests)

| File | Lines | What it holds |
|---|---:|---|
| `stt.go` | 280 | `Provider` interface, `Request`/`Result`/`Attempt`, the eight neutral `Kind`s, `Error` with `Remedy`, and `Reason` |
| `httpx.go` | 425 | The thirteen HTTP guards, the audio content-type allowlist, `safeFilename`, the shared language normaliser, `classifyStatus` |
| `registry.go` | 235 | The name→builder map, `Configure`, and the live `Active`/`Enabled`/`Engine`/`MaxAudioBytes` facade |
| `chain.go` | 224 | The chain runner: order, proportional budgets, panic containment, `Attempt` records |
| `provider_elevenlabs.go` | 124 | Adapter over the **untouched** vendor client |
| `provider_hamsa.go` | 292 | Hamsa realtime provider |
| `provider_openai.go` | 241 | OpenAI provider, built from zero |
| `chain_test.go` | 452 | TC-1 … TC-8 plus the `Reason` forgery tests |
| `provider_test.go` | 412 | TC-13 … TC-15 plus the multipart-injection and quota/rate-limit tests |
| `registry_test.go` | 230 | TC-9 … TC-12, TC-16 and the structural vendor-import scan |

### Modified

| File | Change |
|---|---|
| `src/infrastructure/whatsapp/transcription.go` | +153/-… — the **six** couplings repointed, download sub-budget, per-attempt audit |
| `src/infrastructure/whatsapp/transcription_test.go` | 43 lines — the four edits the panel predicted; the vendor import is gone |
| `src/config/settings.go` | +126 — `STTProviderChain`, `STTStageTimeout`, and the two provider blocks |
| `src/cmd/root.go` | +285 — 15 viper binds, 15 flags, the stage-timeout fallback, `stt.Configure()` at startup, chain-aware logging |
| `src/.env.example` | +61 — the chain block, **names and empty values only** |
| `readme.md` | +71 — the latency paragraph corrected, the provider-chain section, 15 new env-table rows |

### Deliberately NOT changed

- **`src/infrastructure/elevenlabs/stt.go`** — `git diff --stat` on that path is
  empty. This is the evidence for NFR-2: the audited 578-line client and its
  541-line test suite are byte-for-byte what they were, so "the single-provider
  path is behaviour-preserving" is proven by the vendor's own existing tests
  rather than by a new test written to agree with new code.
- **Every deployment runtime file.** `git status --porcelain` matched against
  `docker-compose|golang.Dockerfile|entrypoint.sh|.github/workflows` returns 0
  (AC-22, C-1).
- **`src/.env`** is gitignored (`.gitignore:32`, confirmed with
  `git check-ignore -v`), so the local values added there are not published. The
  documented block went into the **tracked** `.env.example` with empty values.

## Deviations from the plan

Five, all small, none changing an acceptance criterion.

1. **`minAttemptBudget` is a `var`, not a `const`.** The plan wrote it as a
   constant. Held at 3s a test could only exercise the budget arithmetic on
   30-second timescales, which would have made the suite take minutes. It is a
   package-level `var` that nothing outside the package and nothing at run time
   writes, lowered only by a test helper. The alternative — testing the real
   arithmetic at real durations — would have meant either a slow suite or no
   test of the property the panel's biggest finding turned on.

2. **`attemptBudget` gained a clamp the plan did not describe.** The floor could
   exceed what the ceiling had left, so a provider could be promised more time
   than existed. Found by a failing test, not by reading. `budget` is now clamped
   to `remaining` after the floor is applied.

3. **`logSpeechToTextConfiguration` was split**, not merely rewritten. The
   chain-level report is new; ticket 07's ElevenLabs-specific diagnostics (base
   URL validity, plaintext refusal, proxy usability, language pinning) moved
   intact into `logElevenLabsEndpointDiagnostics`. Dropping them would have been
   a silent regression in an area this ticket is meant to leave alone.

4. **The Hamsa response parser accepts two body shapes**, `{"text":...}` and
   `{"data":{"text":...}}`. The vendor's pages show both. One extra branch is
   cheaper than a silent `no_speech` on a call that actually succeeded.

5. **`parseChain` collapses a duplicate entry.** Not in the plan, but
   `STT_PROVIDER_CHAIN=hamsa,hamsa` would otherwise bill one vendor twice for a
   single message, which contradicts REQ-16 ("tried once, never re-entered").

## Panel findings, as built

All 19 adopted findings are in the code. The three that changed the design:

- **Proportional budgets** (`chain.go > attemptBudget`) — the ceiling stays at
  30s and each attempt gets `min(providerTimeout, remaining/(n-i))`. Revision 1
  would have shipped a chain in which a **hung** primary consumed the whole
  ceiling and the fallbacks were never started.
  `TestHungPrimaryStillLeavesBudgetForFallbacks` is the test that fails against
  revision 1's model and passes against this one.
- **`Reason` is a pure lookup** (`stt.go > Reason`) — assembled only from a
  registry name, a fixed sentence per kind, and a provider constant.
  `TestReasonCannotBeForgedByAVendorBody` feeds it a body containing a newline
  and a forged `status=done` line and asserts neither survives.
- **Live registry resolution** (`registry.go > Active`) — a configure-once
  snapshot would have reported "disabled" in the existing transcription tests,
  which mutate `config.ElevenLabsAPIKey` and never run a startup path.

## Validation run

`go build -C src ./...` — clean. `go vet -C src ./...` — clean.

**Full suite: 111 failures before this change, 111 after.** Measured on the
unmodified tree by stashing the entire working set, running, and restoring. Of
those, 105 are the `CGO_ENABLED=0` go-sqlite3 stub and the remainder resolve to a
single genuine pre-existing failure, `TestResolveDocumentMIME/Zip`
(`send_test.go:82`) — a Windows MIME-registry difference
(`application/x-zip-compressed` vs `application/zip`), the same one recorded in
ticket `z8pmx9kzc9`'s verification. **No new failure.**

New and directly relevant packages:

```
ok    github.com/aldinokemal/go-whatsapp-web-multidevice/infrastructure/stt
ok    github.com/aldinokemal/go-whatsapp-web-multidevice/infrastructure/elevenlabs   <- unmodified, unmodified suite
ok    github.com/aldinokemal/go-whatsapp-web-multidevice/cmd
```

### Runtime verification against the real binary

Unit tests prove the functions; these prove the wiring. Built and run for real:

| Check | Result |
|---|---|
| Unknown name is fatal (AC-13) | `level=fatal msg="configuration error: STT_PROVIDER_CHAIN names 1 unknown provider(s): deepgram. Known providers are: elevenlabs, hamsa, openai"` |
| Named-but-unconfigured is skipped (AC-12) | one `level=warning ... "hamsa" ... will be skipped`, then the process started and reported `chain=elevenlabs` |
| Legacy, no chain variable (AC-14) | `chain=elevenlabs primary=elevenlabs/scribe_v2 stage_ceiling=30s max_audio_bytes=16777216` — today's engine string and today's 16 MiB limit |
| Three-provider chain in order (AC-4) | `chain=hamsa -> elevenlabs -> openai primary=hamsa/s2`, each provider reported with its own budget |
| The language trap is surfaced | `HAMSA_STT_LANGUAGE is empty, which for Hamsa means Arabic — it is not auto-detect` |
| All 15 flags registered | present in `--help`, no duplicate-flag panic |

## Not done

**TC-17, the live Hamsa exercise, has not been run** — it needs real Hamsa
credentials, which this environment does not have. It is the test that settles
the two things only a live call can settle: whether Hamsa's realtime endpoint
accepts an ogg/opus container, and whether the auth scheme is `Token` or
`Bearer`. Both are handled by design if the answer is unfavourable — a refused
container fails over to ElevenLabs, and the scheme is a configuration value — but
until it runs, **"Hamsa is the primary" is proven for ordering and not for
transcription.** Recorded as an explicit limit in `verify.md` rather than left to
be discovered later.
