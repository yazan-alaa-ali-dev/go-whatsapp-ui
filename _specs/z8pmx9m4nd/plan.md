---
ticket: z8pmx9m4nd
stage: plan
mode: standard
status: complete
owner: developer
updated: 2026-08-29
links:
  clickup: "https://app.clickup.com/t/z8pmx9m4nd"
  github: ""
---

# Plan — Make Hamsa the primary speech-to-text provider, with ElevenLabs Scribe v2 and OpenAI as ordered fallbacks

> **Revision 2.** Revision 1 was authored before any code and reviewed by the
> advisory panel (senior / security / performance) against the **source**, not
> against its own prose. Every finding is answered in
> [Panel response](#panel-response). Three findings changed the design, five
> corrected a factual claim revision 1 made, and three were declined with reasons.
>
> **The finding that mattered most was found twice, from opposite directions.**
> The performance lens reached it through slot occupancy and the security/senior
> lenses through a documented latency contract: revision 1's timeout model
> (a 75s ceiling with three 30s providers) would have **starved the fallback in
> the default configuration** — a hung primary consumes the whole ceiling and the
> chain runner never starts providers 2 and 3. Revision 1 would have shipped a
> failover that works for a vendor returning `401` and does **not** work for a
> vendor that hangs, which is the dominant vendor failure and the reason the
> ticket exists. See [The timeout model](#the-timeout-model-rewritten-after-the-panel).

## The research finding that decides the design

The ticket's largest stated risk is that "Hamsa's documented contract is **async
and URL-based**; our path is **synchronous and holds decrypted audio in
memory**", and it offers three candidate mechanisms — submit+poll, callback,
WebSocket — each with a real cost. Open question 1 asks whether Hamsa has a
direct-upload or synchronous route "not present in the public documentation".

**It does, and it is documented — on a different page from the batch API.**

| | Batch API (what the ticket describes) | Realtime API (what this plan uses) |
|---|---|---|
| Endpoint | `POST /v1/jobs/transcribe` | `POST /v1/realtime/stt` |
| Audio delivery | `mediaUrl` — a URL Hamsa fetches | `audioBase64` — the bytes, in the request |
| Result | `{jobId}`, then webhook or poll | `{"text": ...}` **in the response** |
| Models | `Hamsa-General-V2.0`, `Hamsa-Conversational-V1.0` | `s2` (default), `s3` |
| Language | `ar` \| `en`, defaults to `ar` | `ar` \| `en`, defaults to `ar` |
| Formats | media URL | "any audio format supported by the backend (WAV, MP3, etc.), base64-encoded" |

Sources: `docs.tryhamsa.com/speech-to-text/quickstart`,
`docs.tryhamsa.com/speech-to-text/real-time`,
`docs.tryhamsa.com/websocket/websocket-stt`,
`docs.tryhamsa.com/speech-to-text/guides/supported-languages`.

This collapses the whole "architectural collision" section of the ticket:

- **Candidate 1 (submit + poll) — rejected.** Still needs a reachable
  `mediaUrl`, so it carries the entire media-exposure problem, and adds polling
  latency inside a budget a webhook consumer is waiting on. There is no documented
  polling endpoint for the job either.
- **Candidate 2 (callback) — rejected.** Breaks REQ-28 (the outbound webhook
  carries a final `transcript_status`), needs a new public inbound endpoint
  (violates C-4), and still needs a `mediaUrl`.
- **Candidate 3 (WebSocket) — rejected.** Solves media exposure but is a second
  protocol, a persistent connection and a per-message handshake, for a request
  that a plain `POST` already answers synchronously.
- **Chosen: the Realtime HTTP API.** One synchronous `POST`, the bytes travel
  inside the request the same way the ElevenLabs multipart body carries them, the
  customer's recording is **never** placed at any URL, `transcript_status` stays
  final, no new endpoint exists, and the provider fits the existing `Provider`
  shape with no special cases anywhere in the runner.

**This answers AC-18 and it is the single most important decision in the plan.**

The security lens confirmed the mechanism removes the media-exposure risk outright
and identified the one exposure it substitutes: with multipart the audio is a byte
buffer no formatter touches, but as `audioBase64` it is a **string field of a
struct**, one `%+v` away from the entire recording in a log line. That becomes an
explicit provider rule below.

### What the research did not settle, and how each is handled

| Open question | Answer found | How this plan handles it |
|---|---|---|
| 1. Direct upload / synchronous route? | **Yes** — `/v1/realtime/stt`, `audioBase64`, synchronous. | Chosen mechanism (above). |
| 2. Polling supported and rate-limited? | Moot — no polling in the chosen route. | Not used. |
| 3. Which model? | The realtime route takes `s2` (default) or `s3`; `Hamsa-General-V2.0` belongs to the **batch** route and is not valid here. | `HAMSA_STT_MODEL`, default `s2` (REQ-29). |
| 4. Language outside `ar`/`en`? | Undocumented. Both routes **default to Arabic** when `language` is omitted. | See "the language trap" below. |
| 5. OpenAI model, and does it need the proxy? | `whisper-1`; **`ogg` is on OpenAI's documented supported-format list**, so a WhatsApp voice note needs no transcoding there. Limit 25 MiB. Proxy need is deployment-specific. | `OPENAI_STT_MODEL` default `whisper-1`; every provider gets its own optional proxy setting. |
| 6. Hamsa size limit below 16 MB? | **Undocumented.** | Not invented. Moot in practice: `MaxAudioBytes()` is a min over the chain and ElevenLabs' 16 MB is the floor whenever it is present (senior lens #14). |
| Auth header: `Token` or `Bearer`? | **The vendor's own docs disagree**: the API reference says `Authorization: Token <key>`, the STT quickstart says `Bearer`. | `HAMSA_AUTH_SCHEME`, **allowlisted to `{Token, Bearer}`**, default `Token`. Kept over the senior lens's objection — see [Panel response](#panel-response). |

### The two risks this mechanism carries, stated now rather than at `/verify`

1. **Audio format.** A WhatsApp voice note is `audio/ogg; codecs=opus`. Hamsa's
   WebSocket page says "any audio format supported by the backend (WAV, MP3,
   etc.)" — ogg/opus is plausible but **not confirmed in writing**, and C-3
   forbids transcoding. If Hamsa refuses the container, Hamsa returns a
   `bad_response` and **the chain fails over to ElevenLabs on every voice note**.
   That is the feature working exactly as designed — the deployment keeps
   transcribing — but it means Hamsa may be primary in name only until a live
   test (TC-17) confirms it. TC-17 is therefore not a formality; it is the test
   that decides whether this ticket delivered its headline.
2. **The language trap.** ElevenLabs' semantics and Hamsa's are **opposite**:
   omitting `language_code` on ElevenLabs means *auto-detect*, and that emptiness
   is deliberate (`settings.go:316-326` documents it at length — pinning makes an
   English recording come back as Arabic-script nonsense). Omitting `language` on
   Hamsa means *Arabic*. Reusing one shared language setting across providers
   would silently turn a deliberate auto-detect into a pin the moment Hamsa
   became primary. Each provider therefore keeps its **own** language setting
   (REQ-8), and `HAMSA_STT_LANGUAGE` ships empty with a comment stating that
   empty means Arabic **for this vendor**.

## Approach

Four moves, in an order where each is independently verifiable.

1. **Add a neutral package, `src/infrastructure/stt`.** It owns the `Provider`
   interface, the neutral error kinds, the registry, the chain runner and the
   package-level facade the whatsapp package will call. Nothing else changes yet.
2. **Adapt ElevenLabs onto the interface without touching its client.**
   `infrastructure/elevenlabs/stt.go` is a 578-line audited file carrying guards
   that are easy to lose in a move. The ticket names rewriting it "the silent
   risk". **This plan does not rewrite it.** The adapter is a small file in `stt`
   that calls `elevenlabs.Transcribe` and maps its four sentinels onto neutral
   kinds. The existing `elevenlabs/stt_test.go` (541 lines) keeps passing
   unmodified, which is the evidence for NFR-2.
3. **Repoint `transcription.go` at the neutral layer** — all **six** couplings at
   once, because leaving any one naming the vendor leaves the chain half-wired
   (`Enabled()` would still gate on ElevenLabs' key while the chain ran Hamsa).
4. **Add the two new providers**, Hamsa then OpenAI, each a self-contained file
   over shared HTTP hardening helpers.

### Why the ElevenLabs client is not moved into `stt`

The two new providers need the same hardening the existing client carries. Those
helpers are written **fresh** in `stt/httpx.go` rather than shared.

Revision 1 justified this with an import cycle. **That justification was wrong**
and the senior lens caught it: a leaf package (`pkg/httpguard`) imported by both
would create no cycle. The real and sufficient reason is the one that survives:
the only way to *share* the helpers is to edit `elevenlabs/stt.go`, which is the
precise risk the ticket flags, and extracting a package used by exactly one caller
is one-caller abstraction. So: ~90 lines exist twice, deliberately, both copies
covered by tests, and the day ElevenLabs is finally migrated the old copy is
deleted whole. The senior lens agreed with the decision and only rejected the
reasoning.

## Design

### Interface

```go
// Provider performs exactly one transcription attempt against one vendor.
// An implementation never retries and never logs.
type Provider interface {
    Name() string                  // registry name, audit identifier: "hamsa"
    Engine() string                // stored-row value: "hamsa/s2"
    Configured() bool              // credentials present
    MaxAudioBytes() int64          // this vendor's own refusal limit
    Timeout() time.Duration        // this vendor's own per-attempt budget
    Transcribe(context.Context, Request) (*Result, error)
}
```

`Request` is `{Audio []byte; Mimetype, MessageID string}` — today's
`elevenlabs.Request`, unchanged in shape. `Result` is today's
`{Text, LanguageCode, AudioDurationSec}` **plus** `Engine string` and
`Attempts []Attempt`. There is deliberately **no** `Result.Provider`: the senior
lens noted it would be a second identity field with no caller, since
`transcription.go` reads only `Engine`.

### Neutral failure kinds, and a `Reason` that a vendor cannot write

```go
type Kind string
const (
    KindUnauthorized  Kind = "unauthorized"
    KindQuotaExceeded Kind = "quota_exceeded"
    KindRegionBlocked Kind = "region_blocked"
    KindRateLimited   Kind = "rate_limited"
    KindBadResponse   Kind = "bad_response"
    KindTimeout       Kind = "timeout"
    KindNetwork       Kind = "network"
    KindUnavailable   Kind = "unavailable"
)

type Error struct {
    Provider string
    Kind     Kind
    Remedy   string   // a compile-time constant supplied by the provider, or ""
    Err      error    // the detailed error; NEVER rendered into Reason()
}
```

**`Reason(err)` is a pure lookup and never renders `Err`.** This is a security
finding, not a style choice: today `transcription.go:216-235` builds the reason
from five compile-time constants, and revision 1 would have replaced it with a
string containing `errorDetail(resp)` — a **remote body**. A vendor (or anything
answering as one) could then embed a newline and a fake `[STT] message ...
status=done` line and forge audit records. So:

```
Reason(err) = provider + ": " + fixedSentence[kind] + optional(" — " + Remedy)
```

Every component is a compile-time constant. The detailed error keeps going to the
existing separate `log.Errorf(...%v)` line, where the `errorDetail`
control-character strip and `utf8.ValidString` repair
(`elevenlabs/stt.go:433-452`) are ported **verbatim**.

`Remedy` answers the senior lens's point that neutral kinds lose the actionable
half of today's line — `"set ELEVENLABS_PROXY_URL"` is what an operator needs, and
a neutral `region_blocked` alone does not carry it. It is a constant owned by the
provider, so it satisfies both lenses at once.

### Chain runner

```go
func Transcribe(ctx context.Context, req Request) (*Result, error)
```

```
active := configured providers, in configured order
if empty                          -> ErrNotConfigured                   (REQ-11)
if len(req.Audio) > MaxAudioBytes() -> refuse ONCE, before the loop      (perf #8)
for i, p := range active:
    remaining := time.Until(deadline)
    if remaining < minAttemptBudget -> stop; later providers never started (REQ-22)
    budget := min(p.Timeout(), remaining / (len(active)-i))              <- see below
    attemptCtx := WithTimeout(ctx, budget)
    res, err := attempt(attemptCtx, p, req)   // attempt() recovers panics (REQ-13)
    record Attempt{Provider, Kind, Latency}                             (REQ-18)
    if err == nil -> return res     // empty text: no_speech stops here (REQ-14, REQ-15)
    // else: continue; p is never revisited                             (REQ-16)
return the last *Error, carrying every Attempt
```

Four properties fall out of this shape rather than being enforced separately:

- **`no_speech` does not fail over** because an empty-text success is `err == nil`
  and the loop returns on the first non-error. The rule is structural, not a
  special case someone can delete.
- **No provider is retried** because the loop advances by index and never
  re-enters.
- **The ceiling stops the chain** because every attempt derives from `ctx`.
- **A provider is never started on a budget too small to succeed on**
  (`minAttemptBudget`, 3s) — the alternative is paying a vendor for a call that
  will certainly be cancelled.

`attempt` is the single place a panic is contained, converting it to
`Error{Kind: KindUnavailable}` so a panicking vendor **fails over** rather than
taking down the message (REQ-13). The existing outer recover in
`transcribeInboundAudio` stays as the second line of defence.

**`stt` does not log** — the same rule `elevenlabs` follows, for the same reason
(everything crossing it is a key, a recording, or the customer's words). The
runner *records* `Attempt` values on the `Result`/`Error`; `transcription.go`
emits them.

### The timeout model, rewritten after the panel

Revision 1 proposed a 75s ceiling with three static 30s budgets, plus a startup
warning when the ceiling was smaller than their sum. The panel dismantled it from
three directions, and all three point at the same replacement.

**What was wrong.** With a 30s ceiling and three 30s budgets, a *hung* primary
consumes the entire ceiling and providers 2 and 3 are never started — failover
works only for fast failures. Raising the ceiling to 75s to fix that is worse, not
better, because of a fact revision 1 had not checked:
`event_message_handler.go:75-78` releases the admission slot with `defer release()`
over the **whole goroutine** — transcription **plus** the agent bridge **plus** the
webhook forward. So the ceiling governs slot occupancy for all 8 process-wide
slots and the per-chat `"a call for this chat is already in flight"` window. A 75s
ceiling would drop throughput from ~16 voice notes/min to ~6.4/min across every
device, and would make a user's second back-to-back voice note reliably lost. And
`readme.md:277-280` plus `settings.go:328-338` both document 30s as *the* bound a
webhook consumer and Chatwoot inherit — so 75s silently triples a published
latency contract.

**What replaces it.** The ceiling **stays at 30s** and the budget is shared
proportionally among the providers that have not yet run:

```
budget_i = min(p_i.Timeout(), remaining / (numActive - i))
```

With a 30s ceiling and three providers that is 10s / 10s / 10s. A *fast* first
failure hands the surplus forward automatically (a 0.2s connection refusal leaves
29.8s, so provider 2 gets 14.9s). A *hung* primary is cut at 10s and the chain
still reaches providers 2 and 3.

This is strictly better than revision 1 on every axis at once, and it is **less**
code:

- Failover now works for the hung primary — the failure the ticket exists for.
- Slot occupancy, throughput and the per-chat window are **byte-for-byte today's**,
  so `newAgentGate(8, 6)` needs no defence beyond "the ceiling did not move" and
  `readme.md`'s latency paragraph stays true.
- NFR-3's "30s, unchanged" is literally true rather than aspirational.
- The startup warning is **deleted**, along with the operator arithmetic it asked
  for. No configuration is required to get working failover.

**The download gets its own sub-budget.** `extractAudioFn` runs under the same
stage context, so a slow WhatsApp CDN fetch silently eats the chain's budget.
It is bounded at one third of the ceiling, so a slow download fails *as a download
failure* instead of starving the chain of its remaining share.

```
stageCtx = WithTimeout(ctx, config.STTStageTimeout)     <- the one ceiling (REQ-21)
  |- extractAudioFn under WithTimeout(stageCtx, ceiling/3)   <- the one download (REQ-23)
  `- stt.Transcribe(stageCtx, ...)                           <- shares what is left
```

**`STT_STAGE_TIMEOUT` defaults to `ELEVENLABS_STT_TIMEOUT`, by an explicit
mechanism.** A literal `30 * time.Second` initialiser would silently *shrink* the
ceiling of a deployment that today sets `ELEVENLABS_STT_TIMEOUT=45s` — a
regression AC-14 forbids. So `settings.go` declares it as `0` (meaning "unset")
and `root.go`, **after both viper binds**, applies:

```go
if config.STTStageTimeout <= 0 { config.STTStageTimeout = config.ElevenLabsSTTTimeout }
```

### Size limit

`MaxAudioBytes()` is the **minimum** over the active providers (REQ-24), computed
**once** at configure time, not per message. Declared limits: ElevenLabs 16 MiB
(today's constant), Hamsa 16 MiB, OpenAI 25 MiB. For today's `elevenlabs`-only
chain the minimum is 16 MiB, so AC-14 holds; for the recommended chain it is also
16 MiB, so nothing regresses. The check is hoisted into the chain runner **before**
the loop — today it lives inside `elevenlabs.Transcribe` (`stt.go:191-196`) and
would otherwise re-run per provider, and for Hamsa it would otherwise run only
after the base64 expansion.

Note the pre-download check at `transcription.go:187` uses the sender-**declared**
`GetFileLength()` (a `uint64`), so it needs an explicit conversion against
`MaxAudioBytes() int64`; the post-download check in the runner is the real one.

### Configuration

`STT_PROVIDER_CHAIN` — comma-separated, ordered, case-insensitive, whitespace
tolerant. Resolution:

```
raw = trim(STT_PROVIDER_CHAIN)
if raw == ""  -> legacy: ["elevenlabs"] if ELEVENLABS_API_KEY set, else []   (REQ-12)
else          -> parse; unknown name -> startup error naming it             (REQ-10)
                 known but unconfigured -> dropped with one warning         (REQ-9)
```

**Resolution is live, not a startup snapshot.** `elevenlabs.Enabled()` reads
`config.ElevenLabsAPIKey` on every call (`elevenlabs/stt.go:177-179`), and
`transcription_test.go:31-59` mutates that setting per test without ever running a
startup path. A configure-once registry would make `Enabled()` false in those
tests and break them. So `Enabled()`, `Active()` and `Engine()` resolve from
`config` on demand — a string split per voice note, against a call that is about
to spend seconds on the network — and `Configure()` does validation and one-shot
warnings only, which is all AC-12/AC-13 require. `MaxAudioBytes()` is memoised
because it is a min over the chain.

The legacy branch is what makes AC-14 true, and it is why REQ-11's "empty chain is
the disabled state" is satisfied **exactly when** `ELEVENLABS_API_KEY` is also
empty — today's disable switch, unchanged.

Per provider (REQ-8), following the `ELEVENLABS_*` shape:

| Vendor | Key | Base URL | Model | Language | Timeout | Proxy |
|---|---|---|---|---|---|---|
| elevenlabs | `ELEVENLABS_API_KEY` | `ELEVENLABS_API_BASE_URL` | fixed `scribe_v2` | `ELEVENLABS_STT_LANGUAGE` | `ELEVENLABS_STT_TIMEOUT` | `ELEVENLABS_PROXY_URL` |
| hamsa | `HAMSA_API_KEY` | `HAMSA_API_BASE_URL` | `HAMSA_STT_MODEL` | `HAMSA_STT_LANGUAGE` | `HAMSA_STT_TIMEOUT` | `HAMSA_PROXY_URL` |
| openai | `OPENAI_API_KEY` | `OPENAI_API_BASE_URL` | `OPENAI_STT_MODEL` | `OPENAI_STT_LANGUAGE` | `OPENAI_STT_TIMEOUT` | `OPENAI_PROXY_URL` |

Plus `STT_PROVIDER_CHAIN`, `STT_STAGE_TIMEOUT` and `HAMSA_AUTH_SCHEME`. Both new
key settings default to `""` and **carry forward the process-list warning**
(`root.go:988-995`) in the code comment *and* in the user-facing flag usage text:
a flag value is visible in the process list to every user on the host.

### The thirteen guards `httpx.go` must carry

Revision 1 listed seven. The security lens found six more in the audited client
that revision 1's list would have silently dropped — and a guard that is not on
the list will not be written. Each new provider is tested against each:

| # | Guard | Source |
|---|---|---|
| 1 | https-or-refuse, with a loopback carve-out for `httptest` | `elevenlabs/stt.go:288-311` |
| 2 | Redirects never followed (`CheckRedirect`) | `:157-160` |
| 3 | Proxy scheme allowlist (`http/https/socks5/socks5h`) | `:339-345` |
| 4 | Proxy host non-empty | `:346-348` |
| 5 | Proxy value never echoed (it carries userinfo) | `:334-338` |
| 6 | Proxy failure **fails the request**, never falls back to direct | `:351-360` |
| 7 | `safeURL` redaction of userinfo, fragment and every query value | `:388-405` |
| 8 | `errorDetail` bounded at 512B, control-chars stripped, UTF-8 repaired | `:426-452` |
| 9 | **`maxResponseBytes` cap on the success-path read** | `:264` |
| 10 | **`safeFilename`** — sanitises the network-sourced `MessageID` in a header | `:525-542` |
| 11 | **`*url.Error` unwrap** before reporting a transport failure | `:226-229` |
| 12 | **Drain-before-close** so the connection returns to the pool | `:232-236` |
| 13 | **Explicit `ContentLength`**, no chunked body to a third party | `:217` |

Plus the audio content-type allowlist (`:140-151`) for the multipart provider, and
three rules that are policy rather than code:

- **No byte of a 401/403 body** reaches an error, a reason or a log line
  (`:239-242` — such a body commonly echoes part of the credential).
- **No byte of a 2xx body** reaches an error — on a JSON parse failure only its
  *length* is reported (`:274-278`). On these endpoints a 2xx body **is the
  transcript**, and a truncated or HTML-wrapped `{"text": ...}` is the most likely
  unparseable body there is.
- **No request payload struct is ever formatted** into an error or a log line.
  With Hamsa the audio is a *string field*, so one `%+v` would render the whole
  recording. The marshal error is kept as `err` alone.

**HTTP clients.** Each provider holds **one package-level `*http.Client`** built at
init — not a per-request factory, which would pay a fresh TCP+TLS handshake per
voice note on a budget a webhook consumer is blocked on and leak unreachable idle
connections. Per-request configuration (the proxy) is read inside `Transport.Proxy`,
exactly as `transcriptionProxy` does at `:351`. Handshake budgets are **5s dial /
5s TLS** rather than the existing client's 10s/10s: three unreachable hosts at
10s+10s would spend 60s of handshake alone inside a 30s ceiling.

### Hamsa provider

`POST {HAMSA_API_BASE_URL}/v1/realtime/stt`, `Authorization: {scheme} {key}` with
the scheme allowlisted to `{Token, Bearer}` (anything else warns at startup and
falls back to `Token`), body `{"audioBase64": ..., "model": ..., "language": ...}`
— `language` omitted when unset, `model` always sent. Response `{"text": ...}`;
empty text is a successful `no_speech`, not a failure.

**The body is built into one exact-size buffer, not by `json.Marshal`.** Base64's
alphabet needs no JSON escaping, so the payload is assembled as
`prefix + base64 + suffix` into a single allocation sized with
`base64.StdEncoding.EncodedLen`. `json.Marshal` would cost three copies of a
22 MB string (its doubling `encodeState` buffer, then the returned copy) on top of
the base64 itself — the performance lens measured revision 1's real peak at
60–90 MB per slot against the 37 MB the plan claimed. One exact buffer makes the
claimed figure true.

Status mapping — **classified from the status line and a decoded `code` field
only, never from raw body bytes**: `401`/`403` → `unauthorized` (body never read);
`402` → `quota_exceeded`; `429` → `rate_limited`; `3xx` → `bad_response` (never
followed); `5xx` → `unavailable`; unparseable body → `bad_response` (length only);
transport error → `network`; context deadline → `timeout`.

Hamsa reports no language and no audio duration, so `Result.LanguageCode` falls
back to the configured language and `AudioDurationSec` stays 0 — leaving
`transcription.go:238`'s existing `if > 0` guard to keep the WhatsApp-reported
duration. That guard already exists and needs no change.

### OpenAI provider

`POST {OPENAI_API_BASE_URL}/v1/audio/transcriptions`, `Authorization: Bearer
{key}`, `multipart/form-data` with `file`, `model`, optional `language`,
`response_format=json`. Response `{"text": ...}`. The multipart body uses the
**same allowlisted** content-type/extension table, the same hand-built part header
and the same `safeFilename`, for the same reason: a sender-controlled mimetype or
message id must not be able to inject a header line. Status mapping as above, plus
`429` whose **decoded** `error.code` is `insufficient_quota` → `quota_exceeded`
rather than `rate_limited`, because those send an operator to two different places.

### Language codes

Every `Result.LanguageCode`, whatever its source, passes through one shared
normaliser before leaving `stt` — charset-restricted and capped at 16 bytes. The
existing client already does this for its own result (`:552-578`); the security
lens noted that Hamsa's *configured* value and any OpenAI `verbose_json` value
would otherwise reach a `VARCHAR` column, a webhook payload and a REST response
unbounded and unnormalised.

### Admission gate (REQ-25, AC-19)

`transcriptionCalls = newAgentGate(8, 6)` **is kept unchanged**, and with the
30s ceiling restored the argument is now simple and checkable:

- **Concurrency is unchanged.** The chain is sequential *inside* one admitted
  slot (`agent_bridge.go:475-517`). 8 slots still means at most 8 goroutines and
  8 resident audio buffers. A three-provider chain adds no parallelism.
- **Slot occupancy is unchanged**, because the ceiling did not move. Throughput
  stays ~16 voice notes/min and the per-chat in-flight window stays ~30s. This is
  the property revision 1 would have broken.
- **Cost per message is bounded at 3 vendor calls**, and per chat at
  6/min × 3 = 18 worst case, only when every provider ahead of the last fails. On
  the green path it is 6/min, exactly as today.
- **Memory.** With the single-buffer encoding: raw audio 16 MiB + one base64 copy
  22.4 MB ≈ **38 MB peak in one slot**, ~300 MB across 8, at the pathological
  16 MiB limit. A real voice note is under 1 MB; 16 MiB is the "something is
  wrong" threshold, not a working size.

Changing the gate would be a change to a working admission control in a ticket
that already touches the whole transcription path; the smallest change that
satisfies REQ-25 is to re-examine it and justify keeping it, which is what this
section does.

## Steps

1. **`stt` package skeleton** — `stt.go` (interface, `Request`, `Result`,
   `Attempt`, `Kind`, `Error`, `Reason`), `httpx.go` (all thirteen guards above,
   the content-type allowlist, `safeFilename`, the language normaliser).
2. **Registry and configuration** — `registry.go`: the name→builder map,
   `Configure()` returning `(warnings []string, err error)`, live `Active()`,
   `Enabled()`, `Engine()` (= the **primary's** engine), memoised
   `MaxAudioBytes()`. Unknown name → error naming the **sanitised** entry;
   unconfigured known name → warning.
3. **Chain runner** — `chain.go`: the loop above, proportional budgets,
   `minAttemptBudget`, panic containment, `Attempt` records.
4. **ElevenLabs adapter** — `provider_elevenlabs.go`: wraps
   `elevenlabs.Transcribe`, maps its four sentinels plus the residue onto neutral
   kinds and attaches the `ELEVENLABS_PROXY_URL` remedies. The vendor client file
   is **not edited**.
5. **Repoint `transcription.go`** — **six** call sites, not five. Revision 1's
   enumeration missed `transcription.go:182`,
   `context.WithTimeout(ctx, config.ElevenLabsSTTTimeout)`, which the whole
   ceiling design depends on; an implementer following revision 1 literally would
   have shipped the chain still bounded by the ElevenLabs timeout. The six:
   `transcribeFn`, `Enabled()`, `Engine()`, `MaxAudioBytes()` (with the `uint64`
   conversion at `:187`), the classification switch → `Reason()`, and the
   `stageCtx` timeout. Plus: overwrite `result.Engine` from `Result.Engine` on
   success, and emit the `Attempt` records.
6. **Hamsa provider** — `provider_hamsa.go` as designed above.
7. **OpenAI provider** — `provider_openai.go` as designed above.
8. **Settings, flags, `.env.example`, readme** — `settings.go` additions,
   `root.go` viper binds and flags, **then** the `STTStageTimeout` fallback
   (ordering matters), `stt.Configure()` at startup with a `Fatalf` on error and a
   `Warn` per skipped provider, and `logSpeechToTextConfiguration` rewritten to
   report the chain.
9. **Tests** — TC-1 … TC-16. In `transcription_test.go` the panel found revision
   1's "only the fake's signature changes" false: it also uses
   `elevenlabs.MaxAudioBytes` (`:308`), `elevenlabs.ErrUnauthorized` (`:240`) and
   `config.ElevenLabsSTTTimeout` (`:36,43,51`, which stops bounding anything once
   the stage moves to `STTStageTimeout`). All four are corrected, which removes
   the vendor import from the file entirely — so the AC-20 scan covers `_test.go`
   files too.

## Files to change

| File | Change |
|---|---|
| `src/infrastructure/stt/stt.go` | **new** — interface, request/result/attempt, kinds, `Error`, `Reason` |
| `src/infrastructure/stt/httpx.go` | **new** — the thirteen guards, allowlist, normaliser |
| `src/infrastructure/stt/registry.go` | **new** — registry, `Configure`, live facade |
| `src/infrastructure/stt/chain.go` | **new** — chain runner, proportional budgets |
| `src/infrastructure/stt/provider_elevenlabs.go` | **new** — adapter over the untouched client |
| `src/infrastructure/stt/provider_hamsa.go` | **new** — Hamsa realtime provider |
| `src/infrastructure/stt/provider_openai.go` | **new** — OpenAI provider |
| `src/infrastructure/stt/*_test.go` | **new** — TC-1 … TC-16 |
| `src/infrastructure/whatsapp/transcription.go` | six couplings repointed |
| `src/infrastructure/whatsapp/transcription_test.go` | four edits; vendor import removed |
| `src/config/settings.go` | new settings block |
| `src/cmd/root.go` | binds, flags, stage-timeout fallback, `Configure()`, chain logging |
| `src/.env.example` | **tracked** — chain + all three provider blocks, names and empty values only |
| `readme.md` | the `ELEVENLABS_STT_TIMEOUT` latency sentence (`:277-280`) is wrong after this ticket; new env-table rows |

`src/infrastructure/elevenlabs/stt.go` is **deliberately absent**. No deployment
runtime file appears (C-1, AC-22).

**On `src/.env`:** revision 1 planned to add the new keys there, and the senior
lens objected that it is a tracked file already holding a live credential. The
tracking half is **incorrect** — `.gitignore:32` covers `.env` at any depth and
`git ls-files` confirms `src/.env` is untracked, which is why the existing live
key at `:53` is not in the repository. The underlying advice still stands and is
adopted: the documented block goes in the **tracked** `src/.env.example` with
empty values, and TC-18 additionally asserts that no key-shaped literal was added
to any tracked file.

## Validation strategy

The `go-source` profile — `go build -C src ./...`, `go vet -C src ./...`,
`go test -C src ./...` — plus:

- **NFR-2 evidence:** `infrastructure/elevenlabs/stt_test.go` passes **unmodified**
  and the file it tests is unchanged, so "the single-provider path is
  behaviour-preserving" is proven by the vendor's own existing suite, not by a new
  test written to agree with the new code.
- **AC-1/AC-20 structurally:** a test asserting no file in
  `infrastructure/whatsapp` — including `_test.go` — imports a vendor package.
- **AC-16 adversarially:** each provider against an `httptest` server whose error
  body **echoes the API key**, asserting the key appears in no returned error; and
  a body containing `\n` plus a forged `[STT] ... status=done` line, asserting
  `Reason()` is unaffected.
- **AC-10 concretely:** a table over (ceiling, provider count, per-provider
  timeout, download duration) asserting each provider's computed budget, that a
  hung primary still leaves providers 2 and 3 a non-zero share, and that a
  download consuming half the ceiling leaves the rest roughly equally divided.
- **TC-17 manually:** a real Arabic voice note through Hamsa, then Hamsa's key
  deliberately invalidated to watch ElevenLabs take over and the stored `engine`
  change. This is the test that settles both the ogg/opus risk and the
  `Token`-vs-`Bearer` ambiguity.

## Rollback

Two levels, and the cheap one is the point of the abstraction:

1. **Configuration, no deploy:** `STT_PROVIDER_CHAIN=elevenlabs` — or removing the
   variable entirely — returns the deployment to exactly today's behaviour. TC-11
   is the test that says it does.
2. **Code:** revert the commit. Nothing outside `src/infrastructure/stt` is new,
   and every edit elsewhere is additive or a call-site repoint.

No migration, no schema change, no stored data to undo.

## Out of scope

Everything in `spec.md > Out of scope`, and specifically: the Hamsa batch API, any
`mediaUrl`, any callback endpoint, the WebSocket channel, transcoding, and any
change to `infrastructure/elevenlabs/stt.go`.

## Panel response

Three lenses reviewed revision 1 against the source: 34 findings, 15 major.
**19 adopted, 3 declined with reasons, 5 corrections to claims revision 1 made,
7 noted.** The three that changed the design are marked ★.

### Adopted — design changes

| # | Lens | Finding | Change |
|---|---|---|---|
| ★1 | perf, senior | Revision 1's 75s ceiling starves the fallback (a hung primary eats it all) **and** triples a documented latency contract; `event_message_handler.go:75-78` holds the admission slot across transcription + agent + webhook, so the ceiling governs process-wide throughput and the per-chat window. | Ceiling stays **30s**; budgets are shared **proportionally** (`remaining/(n-i)`) with a 3s floor. Failover now works for the hung primary, occupancy is unchanged, the startup warning is deleted, and NFR-3 is literally true. |
| ★2 | security | `Reason()` built from a wrapped vendor error lets a remote body inject newlines and **forge audit records**. | `Reason()` is a pure lookup over compile-time constants; the detailed error goes only to the existing `Errorf` line, with `errorDetail`'s control-strip ported verbatim. |
| ★3 | senior | The registry's lifecycle was undefined; a configure-once snapshot breaks `TestTranscriptionAppliesGating` and `TestHandleMessageDispatches...`, which mutate `config.ElevenLabsAPIKey` and never run a startup path. | `Enabled()`/`Active()`/`Engine()` resolve from config **live**, matching `elevenlabs.Enabled()`; `Configure()` validates and warns only. |
| 4 | security | The `httpx.go` list omitted six guards the audited client carries. | All **thirteen** enumerated with a `stt.go:NN` citation each, plus three non-quoting policies, each with a test. |
| 5 | security | Classifying a `403` by its body contradicts `:239-242`, which refuses to read it because such a body echoes the credential. | `401`/`403` → `unauthorized` with the body never read; quota only from `402` or a **decoded** `code` field. |
| 6 | security | "Unparseable body → `bad_response`" had no non-quoting rule, and on a 2xx the body **is the transcript**. | Explicit rule: on a 2xx only the body's *length* is ever reported. |
| 7 | perf | `json.Marshal` on the Hamsa payload costs three copies of a 22 MB string; real peak is 60–90 MB/slot, not 37 MB. | Single exact-size buffer via `EncodedLen`; the 38 MB figure is now true. |
| 8 | perf, security | Revision 1 said "client **factory**" — a per-request client defeats keep-alive and leaks idle connections; three pools also triple the socket ceiling NFR-1 claimed was unchanged. | One **package-level** client per provider with per-request proxy resolution; NFR-1 restated honestly. |
| 9 | perf | Three providers × 10s dial + 10s TLS = 60s of handshake inside a 30s ceiling. | **5s/5s** in `httpx.go`. |
| 10 | perf | The download runs under the stage context and silently eats the chain's budget. | Download bounded at **ceiling/3**; a slow fetch fails as a download failure. |
| 11 | senior | `STT_STAGE_TIMEOUT` "defaults to `ElevenLabsSTTTimeout`" had no mechanism; a literal would **shrink** the ceiling of a deployment setting `ELEVENLABS_STT_TIMEOUT=45s`. | Declared `0`; explicit fallback in `root.go` **after** both binds. |
| 12 | senior | `Reason()` loses the actionable half of today's line (`set ELEVENLABS_PROXY_URL`). | Providers attach a constant `Remedy`; `Reason()` appends it. Compatible with ★2 because it is compile-time. |
| 13 | security | Hamsa's `audioBase64` is a *string field*, one `%+v` from the whole recording in a log. | Explicit rule: no payload struct is ever formatted into an error or log line. |
| 14 | security | The configured Hamsa language and any OpenAI `verbose_json` code reach a `VARCHAR`, a webhook and a REST response unnormalised. | One shared normaliser for every `Result.LanguageCode`. |
| 15 | security | The process-list warning on `--elevenlabs-api-key` was not carried forward. | Same comment and same "Prefer the environment" clause on both new key flags; both default `""`. |
| 16 | security | `HAMSA_AUTH_SCHEME` is free-form on the header carrying the key. | Allowlisted `{Token, Bearer}`, case-insensitive; anything else warns and falls back to `Token`. |
| 17 | perf | `MaxAudioBytes()` recomputed per message; the size check re-runs per provider (and for Hamsa only *after* base64 expansion); a defensive copy per attempt would add 16 MB each. | Memoised at configure; check hoisted **before** the loop; AC-9 asserted on the slice header, not by copying. |
| 18 | perf | Per-attempt audit at Info triples log volume during an outage. | `Attempt` records at **Debug**; exactly one Info line per message, naming the producing provider. |
| 19 | senior | `Result.Provider` has no consumer. | Dropped; `Result.Engine` kept. |

### Declined, with reasons

| # | Lens | Finding | Why not |
|---|---|---|---|
| D1 | security | `Fatalf` on an unknown chain name lets a one-character typo take the gateway offline; nothing in the STT path is fatal today and `root.go:592-605` states the principle. | **The ticket makes this an explicit acceptance criterion** (REQ-10/AC-13) with its own stated rationale: "silently ignoring it would leave an operator believing a vendor is live when nothing is configured." That is the owner's call, not the plan's, and the panel is advisory. Implemented as specified — with the lens's hardening adopted: the offending entry is **bounded and control-stripped** before printing. Recorded here so the owner sees the objection; reversing it is a one-line change if they prefer. |
| D2 | senior | Drop `HAMSA_AUTH_SCHEME` — no AC requires it, and TC-17 settles the ambiguity permanently. | TC-17 is a **manual** test needing a real Hamsa key. If it cannot be run before ship, the ambiguity is unresolved at release, and `Token` being wrong means the primary vendor is 100% dead — the exact failure this ticket exists to make fixable from configuration rather than a redeploy. Kept, but narrowed to the two-value allowlist the security lens asked for. |
| D3 | perf | Move `release()` to fire when `transcribeInboundAudio` returns, cutting occupancy without weakening a bound. | A genuine improvement and correctly reasoned, but it changes admission for the **agent bridge and webhook forward**, which this ticket does not otherwise touch. Out of scope (spec.md > Out of scope: "no change to the agent bridge"). Worth its own ticket. |

### Corrections to revision 1's claims

1. **"Five couplings" was five; the step list needed six.** `transcription.go:182`
   (`WithTimeout(ctx, config.ElevenLabsSTTTimeout)`) was missing from Step 5, and
   the entire ceiling design depends on it. Following revision 1 literally would
   have shipped the chain still bounded by the ElevenLabs timeout. *(senior)*
2. **"Only the `transcribeFn` fake's signature changes" was false.**
   `transcription_test.go` also uses `elevenlabs.MaxAudioBytes` (`:308`),
   `elevenlabs.ErrUnauthorized` (`:240`) and `config.ElevenLabsSTTTimeout`
   (`:36,43,51`). Four edits, and they remove the vendor import — so the AC-20
   scan must cover `_test.go`. *(senior)*
3. **The `httpx.go` duplication was justified by an import cycle that does not
   exist.** A leaf `pkg/httpguard` imported by both would create no cycle. The
   decision stands on the real reason — sharing requires editing the audited file,
   and a one-caller package is not an abstraction. *(senior)*
4. **`src/.env` is not a tracked file.** The senior lens's premise that adding
   keys there would commit credentials is wrong (`.gitignore:32`; `git ls-files`
   confirms). The advice is adopted anyway on its own merits: the block goes in
   the tracked `.env.example` with empty values. *(senior, security)*
5. **Revision 1's memory figure was optimistic by ~2×** (37 MB claimed vs 60–90 MB
   real, ~300 MB vs ~1 GB RSS across 8 slots). Rather than restate the larger
   number, the encoding was changed so the original figure became true. *(perf)*

### Noted, no change

`readme.md` added to the file list (senior — `:277-280` names
`ELEVENLABS_STT_TIMEOUT` as *the* latency bound and the env table needs new rows);
`Engine()` defined as the **primary's** engine, so a failed row names the primary
rather than the last vendor tried (senior); Hamsa's undocumented size limit is
moot while ElevenLabs' 16 MiB floors the min (senior); `net/http`'s `GetBody`
replay on a dead idle connection is a pre-existing soft edge on "no retry", not
introduced here (security); `sensitiveSettingFragments` already contains `"auth"`,
so `HAMSA_AUTH_SCHEME` is redacted in the startup dump — harmless (senior); the
ordering question checks out — repointing all six couplings at once is safe
because `transcriptionApplies` runs before admission and `handleWebhookForward` is
sequentially after the chain, so AC-8's final `transcript_status` survives
(senior).
